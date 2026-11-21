/**
 * 将 dist/ 静态产物封装成已签名的 Android WebView APK。BETA=1 使用独立包名。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const beta = process.env.BETA === '1'
const isWin = process.platform === 'win32'
const exe = (name) => (isWin ? `${name}.exe` : name)
const bat = (name) => (isWin ? `${name}.bat` : name)

const findFirstExisting = (candidates) => candidates.find((item) => item && existsSync(item))

const sdkRoot = findFirstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  'G:\\AndroidSDK',
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  path.join(os.homedir(), 'Android', 'Sdk'),
])
if (!sdkRoot) {
  throw new Error('未找到 Android SDK，请设置 ANDROID_HOME 环境变量')
}

const javaHome = findFirstExisting([
  process.env.JAVA_HOME,
  'D:\\java21',
  'C:\\Program Files\\Java\\latest',
])
const javaBin = (tool) => (javaHome ? path.join(javaHome, 'bin', exe(tool)) : exe(tool))

const latestSubdir = async (parentDir) => {
  const entries = await readdir(parentDir)
  entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  if (entries.length === 0) {
    throw new Error(`目录为空: ${parentDir}`)
  }
  return path.join(parentDir, entries[0])
}

const buildToolsDir = await latestSubdir(path.join(sdkRoot, 'build-tools'))
const platformDir = await latestSubdir(path.join(sdkRoot, 'platforms'))
const androidJar = path.join(platformDir, 'android.jar')
const aapt2 = path.join(buildToolsDir, exe('aapt2'))
const d8 = path.join(buildToolsDir, bat('d8'))
const zipalign = path.join(buildToolsDir, exe('zipalign'))
const apksigner = path.join(buildToolsDir, bat('apksigner'))

const run = (cmd, args, cwd = root) => {
  if (isWin && (cmd.endsWith('.bat') || cmd.endsWith('.cmd'))) {
    execFileSync('cmd.exe', ['/d', '/s', '/c', cmd, ...args], {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}) },
    })
    return
  }
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}) },
  })
}

const distDir = path.join(root, 'dist')
if (!existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('未找到 dist/index.html，请先执行构建生成 dist/')
}

const workDir = path.join(root, 'build', 'apk-work')
const outDir = path.join(root, 'dist-apk')
await rm(workDir, { recursive: true, force: true })
await mkdir(path.join(workDir, 'compiled-res'), { recursive: true })
await mkdir(path.join(workDir, 'gen'), { recursive: true })
await mkdir(path.join(workDir, 'classes'), { recursive: true })
await mkdir(path.join(workDir, 'dex'), { recursive: true })
await mkdir(path.join(workDir, 'assets', 'web'), { recursive: true })
await mkdir(outDir, { recursive: true })

// 1. 拷贝前端静态产物到 assets/web
await cp(distDir, path.join(workDir, 'assets', 'web'), { recursive: true })

const manifestPath = path.join(root, 'android', 'AndroidManifest.xml')
const manifestXml = await readFile(manifestPath, 'utf8')
const pkgMatch = /package="([^"]+)"/.exec(manifestXml)
if (!pkgMatch) {
  throw new Error('AndroidManifest.xml 中未找到 package 属性')
}
const javaPackage = pkgMatch[1]
const pkgSegments = javaPackage.split('.')

// 2. aapt2 编译并链接资源
let resources = path.join(root, 'android', 'res')
if (beta) {
  const betaResources = path.join(workDir, 'res')
  await cp(resources, betaResources, { recursive: true })
  resources = betaResources
  const stringsPath = path.join(resources, 'values', 'strings.xml')
  const strings = await readFile(stringsPath, 'utf8')
  await writeFile(
    stringsPath,
    strings.replace(/(<string name="app_name">)[^<]*(<\/string>)/, '$1API demo β$2')
  )
}
const compiledResZip = path.join(workDir, 'compiled-res.zip')
run(aapt2, ['compile', '--dir', resources, '-o', compiledResZip])

const unalignedApk = path.join(workDir, 'unaligned.apk')
run(aapt2, [
  'link',
  '-I',
  androidJar,
  '--manifest',
  manifestPath,
  ...(beta
    ? ['--rename-manifest-package', `${javaPackage}.beta`, '--custom-package', javaPackage]
    : []),
  '--java',
  path.join(workDir, 'gen'),
  '-o',
  unalignedApk,
  compiledResZip,
])

// 3. javac 编译 Java 源码与 R.java
const rJava = path.join(workDir, 'gen', ...pkgSegments, 'R.java')
const sourceDir = path.join(root, 'android', 'java', ...pkgSegments)
const javaFiles = (await readdir(sourceDir))
  .filter((name) => name.endsWith('.java'))
  .map((name) => path.join(sourceDir, name))
run(javaBin('javac'), [
  '--release',
  '11',
  '-encoding',
  'UTF-8',
  '-cp',
  androidJar,
  '-d',
  path.join(workDir, 'classes'),
  rJava,
  ...javaFiles,
])

// 4. d8 将 class 转为 classes.dex
const classDir = path.join(workDir, 'classes', ...pkgSegments)
const classFiles = (await readdir(classDir))
  .filter((name) => name.endsWith('.class'))
  .map((name) => path.join(classDir, name))

run(d8, [
  '--lib',
  androidJar,
  '--min-api',
  '26',
  '--output',
  path.join(workDir, 'dex'),
  ...classFiles,
])

// 5. 将 assets/（使用标准正斜杠条目名）与 classes.dex 打入 APK
run(javaBin('jar'), [
  'uf',
  unalignedApk,
  '-C',
  workDir,
  'assets',
  '-C',
  path.join(workDir, 'dex'),
  'classes.dex',
])

// 6. zipalign 4 字节对齐
const alignedApk = path.join(workDir, 'aligned.apk')
run(zipalign, ['-f', '-p', '4', unalignedApk, alignedApk])

// 7. 准备 debug.keystore 并使用 apksigner 签名
const androidConfigDir = path.join(os.homedir(), '.android')
await mkdir(androidConfigDir, { recursive: true })
const keystorePath = path.join(androidConfigDir, 'debug.keystore')
if (!existsSync(keystorePath)) {
  run(javaBin('keytool'), [
    '-genkeypair',
    '-v',
    '-keystore',
    keystorePath,
    '-storepass',
    'android',
    '-alias',
    'androiddebugkey',
    '-keypass',
    'android',
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-dname',
    'CN=Android Debug,O=Android,C=US',
  ])
}

const finalApk = path.join(outDir, beta ? 'chat-demo-beta.apk' : 'chat-demo.apk')
run(apksigner, [
  'sign',
  '--ks',
  keystorePath,
  '--ks-key-alias',
  'androiddebugkey',
  '--ks-pass',
  'pass:android',
  '--key-pass',
  'pass:android',
  '--out',
  finalApk,
  alignedApk,
])

await rm(workDir, { recursive: true, force: true })
const { size } = await stat(finalApk)
console.log(`APK 已生成：${path.relative(root, finalApk)}（${(size / 1024 / 1024).toFixed(2)} MB）`)
