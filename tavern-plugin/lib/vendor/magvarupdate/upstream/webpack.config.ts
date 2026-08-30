import HtmlWebpackPlugin from 'html-webpack-plugin';
import _ from 'lodash';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import RemarkHTML from 'remark-html';
import { Server } from 'socket.io';
import TerserPlugin from 'terser-webpack-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import unpluginAutoImport from 'unplugin-auto-import/webpack';
import {
    VueUseComponentsResolver,
    VueUseDirectiveResolver,
} from 'unplugin-vue-components/resolvers';
import unpluginVueComponents from 'unplugin-vue-components/webpack';
import { VueLoaderPlugin } from 'vue-loader';
import webpack from 'webpack';

let io: Server;
function watch_tavern_helper(compiler: webpack.Compiler) {
    if (compiler.options.watch) {
        if (!io) {
            io = new Server(6622, { cors: { origin: '*' } });
            console.info(`\x1b[36m[tavern_helper]\x1b[0m 已启动酒馆监听服务`);
            io.on('connect', socket => {
                console.info(
                    `\x1b[36m[tavern_helper]\x1b[0m 成功连接到酒馆网页 '${socket.id}', 初始化推送...`
                );
                io.emit('iframe_updated');
                socket.on('disconnect', reason => {
                    console.info(
                        `\x1b[36m[tavern_helper]\x1b[0m 与酒馆网页 '${socket.id}' 断开连接: ${reason}`
                    );
                });
            });
        }

        compiler.hooks.done.tap('watch_tavern_helper', () => {
            console.info('\n\x1b[36m[tavern_helper]\x1b[0m 检测到完成编译, 推送更新事件...');
            if (compiler.options.plugins.some(plugin => plugin instanceof HtmlWebpackPlugin)) {
                io.emit('message_iframe_updated');
            } else {
                io.emit('script_iframe_updated');
            }
        });
    }
}

function config(_env: any, argv: any): webpack.Configuration {
    // 获取构建时常量
    const buildDate = (() => {
        const date = new Date();
        const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000); // 转成 UTC+8 时间
        const year = utc8.getUTCFullYear();
        const month = String(utc8.getUTCMonth() + 1).padStart(2, '0');
        const day = String(utc8.getUTCDate()).padStart(2, '0');
        const hour = String(utc8.getUTCHours()).padStart(2, '0');
        const minute = String(utc8.getUTCMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}:${minute}`;
    })();
    let commitId = 'unknown';
    try {
        commitId = child_process
            .execSync('git rev-parse --short HEAD', { encoding: 'utf-8' })
            .trim();
    } catch (error) {
        console.warn('无法获取 Git commit ID:', error);
    }

    return {
        experiments: {
            outputModule: true,
        },
        devtool: argv.mode === 'production' ? 'source-map' : 'eval-source-map',
        watchOptions: {
            ignored: ['**/dist', '**/node_modules'],
        },
        entry: path.join(import.meta.dirname, 'src/main.ts'),
        target: 'browserslist',
        output: {
            devtoolNamespace: 'tavern_helper_template',
            devtoolModuleFilenameTemplate: info => {
                const resource_path = decodeURIComponent(info.resourcePath.replace(/^\.\//, ''));
                const is_direct = info.allLoaders === '';
                const is_vue_script =
                    resource_path.match(/\.vue$/) &&
                    info.query.match(/\btype=script\b/) &&
                    !info.allLoaders.match(/\bts-loader\b/);

                return `${is_direct === true ? 'src' : 'webpack'}://${info.namespace}/${resource_path}${is_direct || is_vue_script ? '' : '?' + info.hash}`;
            },
            filename: `bundle.js`,
            path: path.join(import.meta.dirname, 'artifact'),
            chunkFilename: `bundle.[contenthash].chunk.js`,
            asyncChunks: true,
            clean: true,
            publicPath: '',
            library: {
                type: 'module',
            },
        },
        module: {
            rules: [
                {
                    test: /\.vue$/,
                    use: 'vue-loader',
                    exclude: /node_modules/,
                },
                {
                    oneOf: [
                        {
                            test: /\.tsx?$/,
                            loader: 'ts-loader',
                            options: {
                                transpileOnly: true,
                                onlyCompileBundledFiles: true,
                                compilerOptions: {
                                    noUnusedLocals: false,
                                    noUnusedParameters: false,
                                },
                            },
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.(sa|sc)ss$/,
                            use: ['postcss-loader', 'sass-loader'],
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.css$/,
                            use: ['postcss-loader'],
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.tsx?$/,
                            loader: 'ts-loader',
                            options: {
                                transpileOnly: true,
                                onlyCompileBundledFiles: true,
                                compilerOptions: {
                                    noUnusedLocals: false,
                                    noUnusedParameters: false,
                                },
                            },
                            resourceQuery: /url/,
                            type: 'asset/inline',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.(sa|sc)ss$/,
                            use: ['postcss-loader', 'sass-loader'],
                            resourceQuery: /url/,
                            type: 'asset/inline',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.css$/,
                            use: ['postcss-loader'],
                            resourceQuery: /url/,
                            type: 'asset/inline',
                            exclude: /node_modules/,
                        },
                        {
                            resourceQuery: /url/,
                            type: 'asset/inline',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.tsx?$/,
                            loader: 'ts-loader',
                            options: {
                                transpileOnly: true,
                                onlyCompileBundledFiles: true,
                                compilerOptions: {
                                    noUnusedLocals: false,
                                    noUnusedParameters: false,
                                },
                            },
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.html$/,
                            use: 'html-loader',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.md$/,
                            use: [
                                {
                                    loader: 'html-loader',
                                },
                                {
                                    loader: 'remark-loader',
                                    options: {
                                        remarkOptions: {
                                            plugins: [RemarkHTML],
                                        },
                                    },
                                },
                            ],
                        },
                        {
                            test: /\.ya?ml$/,
                            loader: 'yaml-loader',
                            options: { asStream: true },
                            resourceQuery: /stream/,
                        },
                        {
                            test: /\.ya?ml$/,
                            loader: 'yaml-loader',
                        },
                        {
                            test: /\.vue\.s(a|c)ss$/,
                            use: [
                                { loader: 'vue-style-loader', options: { ssrId: true } },
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                                'sass-loader',
                            ],
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.vue\.css$/,
                            use: [
                                { loader: 'vue-style-loader', options: { ssrId: true } },
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                            ],
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.s(a|c)ss$/,
                            use: [
                                'style-loader',
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                                'sass-loader',
                            ],
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.css$/,
                            use: [
                                'style-loader',
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                            ],
                            exclude: /node_modules/,
                        },
                    ],
                },
            ],
        },
        resolve: {
            extensions: ['.ts', '.js', '.tsx', '.jsx', '.css'],
            plugins: [
                new TsconfigPathsPlugin({
                    extensions: ['.ts', '.js', '.tsx', '.jsx'],
                    configFile: path.join(import.meta.dirname, 'tsconfig.json'),
                }),
            ],
            alias: {},
        },
        plugins: [
            new MiniCssExtractPlugin(),
            { apply: watch_tavern_helper },
            new VueLoaderPlugin(),
            unpluginAutoImport({
                dts: true,
                dtsMode: 'overwrite',
                imports: [
                    'vue',
                    'pinia',
                    '@vueuse/core',
                    { from: 'dedent', imports: [['default', 'dedent']] },
                    { from: 'klona', imports: ['klona'] },
                    { from: 'vue-final-modal', imports: ['useModal'] },
                    { from: 'zod', imports: ['z'] },
                ],
            }),
            unpluginVueComponents({
                dts: true,
                syncMode: 'overwrite',
                // globs: ['src/panel/component/*.vue'],
                resolvers: [VueUseComponentsResolver(), VueUseDirectiveResolver()],
            }),
            new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
            new webpack.DefinePlugin({
                __BUILD_DATE__: JSON.stringify(buildDate),
                __COMMIT_ID__: JSON.stringify(commitId),
                __VUE_OPTIONS_API__: false,
                __VUE_PROD_DEVTOOLS__: process.env.CI !== 'true',
                __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
                __VUE_I18N_FULL_INSTALL__: true,
                __VUE_I18N_LEGACY_API__: false,
                __INTLIFY_DROP_MESSAGE_COMPILER__: false,
                __INTLIFY_PROD_DEVTOOLS__: false,
            }),
        ],
        optimization: {
            minimize: true,
            minimizer: [
                argv.mode === 'production'
                    ? new TerserPlugin({
                          terserOptions: {
                              format: { quote_style: 1 },
                              mangle: { reserved: ['_', 'toastr', 'YAML', '$', 'z'] },
                          },
                      })
                    : new TerserPlugin({
                          extractComments: false,
                          terserOptions: {
                              format: { beautify: true, indent_level: 2 },
                              compress: false,
                              mangle: false,
                          },
                      }),
            ],
            splitChunks: {
                chunks: 'async',
                minSize: 20000,
                minChunks: 1,
                maxAsyncRequests: 30,
                maxInitialRequests: 30,
                cacheGroups: {
                    vendor: {
                        name: 'vendor',
                        test: /[\\/]node_modules[\\/]/,
                        priority: -10,
                    },
                    default: {
                        name: 'default',
                        minChunks: 2,
                        priority: -20,
                        reuseExistingChunk: true,
                    },
                },
            },
        },
        externals: ({ context, request }, callback) => {
            if (!context || !request) {
                return callback();
            }

            if (
                request.startsWith('-') ||
                request.startsWith('.') ||
                request.startsWith('/') ||
                request.startsWith('!') ||
                request.startsWith('http') ||
                request.startsWith('@/') ||
                request.startsWith('@util/') ||
                path.isAbsolute(request) ||
                fs.existsSync(path.join(context, request)) ||
                fs.existsSync(request)
            ) {
                return callback();
            }

            if (
                ['vue', 'vue-router'].every(key => request !== key) &&
                ['pixi', 'react', 'vue', 'pinia'].some(key => request.includes(key))
            ) {
                return callback();
            }
            const global = {
                jquery: '$',
                lodash: '_',
                showdown: 'showdown',
                toastr: 'toastr',
                vue: 'Vue',
                'vue-router': 'VueRouter',
                yaml: 'YAML',
                zod: 'z',
            };
            if (request in global) {
                return callback(null, 'var ' + global[request as keyof typeof global]);
            }
            const cdn = {
                sass: 'https://jspm.dev/sass',
            };
            return callback(
                null,
                'module-import ' +
                    (cdn[request as keyof typeof cdn] ??
                        `https://testingcf.jsdelivr.net/npm/${request}/+esm`)
            );
        },
    };
}

export default config;
