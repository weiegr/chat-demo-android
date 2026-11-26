import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'

const dev = process.env.NODE_ENV !== 'production'
// 覆盖 Android 8.0+ 且 WebView 已更新到 Chromium 66 以上的设备（含 Magic UI 3.1 / EMUI 10.1 常见内置 Chromium 74~79）。
// 注意：async generator / for await 需要 Chromium 63+，AbortController 需要 66+，ResizeObserver 需要 64+；
// 出厂 WebView 58~61 的机型必须先更新 Android System WebView，否则会在解析主包时报语法错误。
const targets = ['chrome >= 66', 'edge >= 79', 'safari >= 14', 'firefox >= 78']
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

type ConfigOptions = {
  /** 公开 API 的地址，注入为 __API_ORIGIN__ */
  apiOrigin?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
  /** 产出可离线单文件：合并全部异步 chunk 并内联脚本、样式、字体，供 file://、content:// 直接打开 */
  singleFile?: boolean
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin = 'https://api.deepseek.com',
  devServer,
  singleFile = false,
}: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  target: ['web', 'es2017'],
  entry: './src/main.tsx',
  output: {
    path: path.resolve(root, singleFile ? 'dist-single' : 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      // 第三方依赖（如 mermaid / prismjs / katex）也可能含 ES2020+ 语法，一并降级避免低版本 WebView 解析报错
      {
        test: /\.m?js$/,
        include: /[\\/]node_modules[\\/]/,
        exclude: /[\\/]node_modules[\\/](?:react|react-dom|scheduler|@swc)[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          isModule: 'unknown',
          jsc: {
            parser: { syntax: 'ecmascript' },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      // 单文件模式下字体直接转成 data URI，避免再依赖相邻的 media 目录
      { test: /\.(woff2?|ttf)$/, type: singleFile ? 'asset/inline' : 'asset/resource' },
    ],
  },
  plugins: [
    // 单文件模式把动态 import 的 chunk 全部并进入口，运行时不再发起资源请求
    ...(singleFile ? [new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] : []),
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: process.env.BETA === '1' ? './src/index.beta.html' : './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
    }),
    new rspack.DefinePlugin({
      __API_ORIGIN__: JSON.stringify(apiOrigin),
      __SINGLE_FILE__: singleFile,
      // 3.0.0 起正式版默认包含全部功能；仅在需要临时关闭 Beta 功能时显式传 BETA=0
      __BETA__: JSON.stringify(process.env.BETA !== '0'),
    }),
    new rspack.CopyRspackPlugin({
      patterns: [{ from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' }],
    }),
  ],
  optimization: {
    minimizer: [
      new rspack.SwcJsMinimizerRspackPlugin({
        minimizerOptions: { ecma: 2017 },
      }),
      new rspack.LightningCssMinimizerRspackPlugin({
        minimizerOptions: { targets },
      }),
    ],
  },
  performance: { hints: false },
  devServer: { port: 8090, ...devServer },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig({ singleFile: process.env.SINGLE_FILE === '1' }))
