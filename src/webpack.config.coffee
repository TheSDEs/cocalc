# CoCalc, by SageMath, Inc., (c) 2016, 2017 -- License: AGPLv3

###
# Webpack configuration file

Run dev server with source maps:

    npm run webpack-watch

Then visit (say)

    https://dev0.sagemath.com/

or for smc-in-smc project, info.py URL, e.g.

    https://cloud.sagemath.com/14eed217-2d3c-4975-a381-b69edcb40e0e/port/56754/

This is far from ready to use yet, e.g., we need to properly serve primus websockets, etc.:

    webpack-dev-server --port=9000 -d

Resources for learning webpack:

    - https://github.com/petehunt/webpack-howto
    - http://webpack.github.io/docs/tutorials/getting-started/

---

## Information for developers

This webpack config file might look scary, but it only consists of a few moving parts.

1. There is the "main" SMC application, which is split into "css", "lib" and "smc":
   1. css: a collection of all static styles from various locations. It might be possible
      to use the text extraction plugin to make this a .css file, but that didn't work out.
      Some css is inserted, but it doesn't work and no styles are applied. In the end,
      it doesn't matter to load it one way or the other. Furthermore, as .js is even better,
      because the initial page load is instant and doesn't require to get the compiled css styles.
   2. lib: this is a compilation of the essential js files in webapp-lib (via webapp-lib.coffee)
   3. smc: the core smc library. besides this, there are also chunks ([number]-hash.js) that are
      loaded later on demand (read up on `require.ensure`).
      For example, such a chunkfile contains latex completions, the data for the wizard, etc.
2. There are static html files for the policies.
   The policy files originate in webapp-lib/policies, where at least one file is generated by update_react_static.
   That script runs part of the smc application in node.js to render to html.
   Then, that html output is included into the html page and compiled.
   It's not possible to automate this fully, because during the processing of these templates,
   the "css" chunk from point 1.1 above is injected, too.
   In the future, also other elements from the website (e.g. <Footer/>) will be rendered as
   separate static html template elements and included there.
3. There are auxiliary files for the "video chat" functionality. That might be redone differently, but
   for now rendering to html only works via the html webpack plugin in such a way,
   that it rewrites paths and post processes the files correctly to work.

The remaining configuration deals with setting up variables (misc_node contains the centralized
information about where the page is getting rendered to, because also the hub.coffee needs to know
about certain file locations)

Development vs. Production: There are two variables DEVMODE and PRODMODE.
* Prodmode:
  * additional compression is enabled (do *not* add the -p switch to webpack, that's done here explicitly!)
  * all output filenames, except for the essential .html files, do have hashes and a rather flat hierarchy.
* Devmode:
  * Apply as little additional plugins as possible (compiles faster).
  * File names have no hashes, or hashes are deterministically based on the content.
    This means, when running webpack-watch, you do not end up with a growing pile of
    thousands of files in the output directory.

MathJax: It lives in its own isolated world. This means, don't mess with the MathJax.js ...
It needs to know from where it is loaded (the path in the URL), to retrieve many additional files on demand.
That's also the main reason why it is slow, because for each file a new SSL connection has to be setup!
(unless, http/2 or spdy do https pipelining).
How do we help MathJax a little bit by caching it, when the file names aren't hashed?
The trick is to add the MathJax version number to the path, such that it is unique and will definitely
trigger a reload after an update of MathJax.
The MathjaxVersionedSymlink below (in combination with misc_node.MATHJAX_LIB)
does extract the MathJax version number, computes the path, and symlinks to its location.
Why in misc_node? The problem is, that also the jupyter server (in its isolated iframe),
needs to know about the MathJax URL.
That way, the hub can send down the URL to the jupyter server (there is no webapp client in between).
###

'use strict'

_             = require('lodash')
webpack       = require('webpack')
path          = require('path')
fs            = require('fs')
glob          = require('glob')
child_process = require('child_process')
misc          = require('smc-util/misc')
misc_node     = require('smc-util-node/misc_node')
async         = require('async')
program       = require('commander')

SMC_VERSION   = require('smc-util/smc-version').version
theme         = require('smc-util/theme')

git_head      = child_process.execSync("git rev-parse HEAD")
GIT_REV       = git_head.toString().trim()
TITLE         = theme.SITE_NAME
DESCRIPTION   = theme.APP_TAGLINE
SMC_REPO      = 'https://github.com/sagemathinc/cocalc'
SMC_LICENSE   = 'AGPLv3'
WEBAPP_LIB    = misc_node.WEBAPP_LIB
INPUT         = path.resolve(__dirname, WEBAPP_LIB)
OUTPUT        = path.resolve(__dirname, misc_node.OUTPUT_DIR)
DEVEL         = "development"
NODE_ENV      = process.env.NODE_ENV || DEVEL
NODE_DEBUG    = process.env.NODE_DEBUG
PRODMODE      = NODE_ENV != DEVEL
COMP_ENV      = (process.env.CC_COMP_ENV || PRODMODE) and (fs.existsSync('webapp-lib/compute-components.json'))
CDN_BASE_URL  = process.env.CDN_BASE_URL    # CDN_BASE_URL must have a trailing slash
DEVMODE       = not PRODMODE
MINIFY        = !! process.env.WP_MINIFY
DEBUG         = '--debug' in process.argv
MEASURE       = process.env.MEASURE
SOURCE_MAP    = !! process.env.SOURCE_MAP
STATICPAGES   = !! process.env.CC_STATICPAGES  # special mode where just the landing page is built
date          = new Date()
BUILD_DATE    = date.toISOString()
BUILD_TS      = date.getTime()
GOOGLE_ANALYTICS = misc_node.GOOGLE_ANALYTICS
CC_NOCLEAN    = !! process.env.CC_NOCLEAN
KUCALC_MODE   = !! process.env.KUCALC_MODE

# create a file base_url to set a base url
BASE_URL      = misc_node.BASE_URL

# check and sanitiziation (e.g. an exising but empty env variable is ignored)
# CDN_BASE_URL must have a trailing slash
if not CDN_BASE_URL? or CDN_BASE_URL.length == 0
    CDN_BASE_URL = null
else
    if CDN_BASE_URL[-1..] isnt '/'
        throw new Error("CDN_BASE_URL must be an URL-string ending in a '/' -- but it is #{CDN_BASE_URL}")

# output build environment variables of webpack
console.log "SMC_VERSION      = #{SMC_VERSION}"
console.log "SMC_GIT_REV      = #{GIT_REV}"
console.log "NODE_ENV         = #{NODE_ENV}"
console.log "NODE_DEBUG       = #{NODE_DEBUG}"
console.log "COMP_ENV         = #{COMP_ENV}"
console.log "BASE_URL         = #{BASE_URL}"
console.log "CDN_BASE_URL     = #{CDN_BASE_URL}"
console.log "DEBUG            = #{DEBUG}"
console.log "MINIFY           = #{MINIFY}"
console.log "MEASURE          = #{MEASURE}"
console.log "INPUT            = #{INPUT}"
console.log "OUTPUT           = #{OUTPUT}"
console.log "GOOGLE_ANALYTICS = #{GOOGLE_ANALYTICS}"
console.log "CC_NOCLEAN       = #{CC_NOCLEAN}"
console.log "KUCALC_MODE      = #{KUCALC_MODE}"


# mathjax version → symlink with version info from package.json/version
if CDN_BASE_URL?
    # the CDN url does not have the /static/... prefix!
    MATHJAX_URL = CDN_BASE_URL + path.join(misc_node.MATHJAX_SUBDIR, 'MathJax.js')
else
    MATHJAX_URL = misc_node.MATHJAX_URL  # from where the files are served
MATHJAX_ROOT    = misc_node.MATHJAX_ROOT # where the symlink originates
MATHJAX_LIB     = misc_node.MATHJAX_LIB  # where the symlink points to
console.log "MATHJAX_URL      = #{MATHJAX_URL}"
console.log "MATHJAX_ROOT     = #{MATHJAX_ROOT}"
console.log "MATHJAX_LIB      = #{MATHJAX_LIB}"

# fallback case: if COMP_ENV is false (default) we still need empty json files to satisfy the webpack dependencies
if not COMP_ENV
    for fn in ['webapp-lib/compute-components.json', 'webapp-lib/compute-inventory.json']
        continue if fs.existsSync(fn)
        fs.writeFileSync(fn, '{}')

# adds a banner to each compiled and minified source .js file
# webpack2: https://webpack.js.org/guides/migrating/#bannerplugin-breaking-change
banner = new webpack.BannerPlugin(
    banner   : """\
               This file is part of #{TITLE}.
               It was compiled #{BUILD_DATE} at revision #{GIT_REV} and version #{SMC_VERSION}.
               See #{SMC_REPO} for its #{SMC_LICENSE} code.
               """
    entryOnly: true
)

# webpack plugin to do the linking after it's "done"
class MathjaxVersionedSymlink
    apply: (compiler) ->
        # make absolute path to the mathjax lib (lives in node_module of smc-webapp)
        symto = path.resolve(__dirname, "#{MATHJAX_LIB}")
        console.log("mathjax symlink: pointing to #{symto}")
        mksymlink = (dir, cb) ->
            fs.access dir, (err) ->
                if err
                    fs.symlink(symto, dir, cb)
        done = (compilation) ->
            async.concat([MATHJAX_ROOT, misc_node.MATHJAX_NOVERS], mksymlink)
        plugin = name: 'MathjaxVersionedSymlink'
        compiler.hooks.done.tap(plugin, done)

mathjaxVersionedSymlink = new MathjaxVersionedSymlink()

if not CC_NOCLEAN
    # cleanup like "make distclean"
    # otherwise, compiles create an evergrowing pile of files
    CleanWebpackPlugin = require('clean-webpack-plugin')
    cleanWebpackPlugin = new CleanWebpackPlugin [OUTPUT],
                                                verbose: true
                                                dry: false

# assets.json file
AssetsPlugin = require('assets-webpack-plugin')
assetsPlugin = new AssetsPlugin
                        path       : OUTPUT
                        filename   : 'assets.json'
                        fullPath   : no
                        prettyPrint: true
                        metadata:
                            git_ref   : GIT_REV
                            version   : SMC_VERSION
                            built     : BUILD_DATE
                            timestamp : BUILD_TS

# https://www.npmjs.com/package/html-webpack-plugin
HtmlWebpackPlugin = require('html-webpack-plugin')
# we need our own chunk sorter, because just by dependency doesn't work
# this way, we can be 100% sure
smcChunkSorter = (a, b) ->
    order = ['css', 'fill', 'vendor', 'smc']
    if order.indexOf(a.names[0]) < order.indexOf(b.names[0])
        return -1
    else
        return 1

# https://github.com/kangax/html-minifier#options-quick-reference
htmlMinifyOpts =
    empty: true
    removeComments: true
    minifyJS : true
    minifyCSS : true
    collapseWhitespace : true
    conservativeCollapse : true

# when base_url_html is set, it is hardcoded into the index page
# it mimics the logic of the hub, where all trailing slashes are removed
# i.e. the production page has a base url of '' and smc-in-smc has '/.../...'
base_url_html = BASE_URL # do *not* modify BASE_URL, it's needed with a '/' down below
while base_url_html and base_url_html[base_url_html.length-1] == '/'
    base_url_html = base_url_html.slice(0, base_url_html.length-1)


# this is the main app.html file, which should be served without any caching
# config: https://github.com/jantimon/html-webpack-plugin#configuration
pug2app = new HtmlWebpackPlugin(
                        date             : BUILD_DATE
                        title            : TITLE
                        description      : DESCRIPTION
                        BASE_URL         : base_url_html
                        theme            : theme
                        COMP_ENV         : COMP_ENV
                        components       : {}   # no data needed, empty is fine
                        inventory        : {}   # no data needed, empty is fine
                        git_rev          : GIT_REV
                        mathjax          : MATHJAX_URL
                        filename         : 'app.html'
                        chunksSortMode   : smcChunkSorter
                        inject           : 'body'
                        hash             : PRODMODE
                        template         : path.join(INPUT, 'app.pug')
                        minify           : htmlMinifyOpts
                        GOOGLE_ANALYTICS : GOOGLE_ANALYTICS
)


# static html pages
# they only depend on the css chunk
staticPages = []
# in the root directory (doc/ and policies/ is below)
for [fn_in, fn_out] in [['index.pug', 'index.html']]
    staticPages.push(new HtmlWebpackPlugin(
                        date             : BUILD_DATE
                        title            : TITLE
                        description      : DESCRIPTION
                        BASE_URL         : base_url_html
                        theme            : theme
                        COMP_ENV         : COMP_ENV
                        components       : {}   # no data needed, empty is fine
                        inventory        : {}   # no data needed, empty is fine
                        git_rev          : GIT_REV
                        mathjax          : MATHJAX_URL
                        filename         : fn_out
                        chunks           : ['css']
                        inject           : 'head'
                        hash             : PRODMODE
                        template         : path.join(INPUT, fn_in)
                        minify           : htmlMinifyOpts
                        GOOGLE_ANALYTICS : GOOGLE_ANALYTICS
                        SCHEMA           : require('smc-util/schema')
                        PREFIX           : if fn_in == 'index.pug' then '' else '../'
    ))

# doc pages
for dp in glob.sync('webapp-lib/doc/*.pug')
    continue if path.basename(dp)[0] == '_'
    continue if (path.basename(dp).indexOf('software-') == 0) and (COMP_ENV)
    output_fn = "doc/#{misc.change_filename_extension(path.basename(dp), 'html')}"
    staticPages.push(new HtmlWebpackPlugin(
                        filename         : output_fn
                        date             : BUILD_DATE
                        title            : TITLE
                        theme            : theme
                        COMP_ENV         : COMP_ENV
                        components       : {}   # no data needed, empty is fine
                        inventory        : {}   # no data needed, empty is fine
                        template         : dp
                        chunks           : ['css']
                        inject           : 'head'
                        minify           : htmlMinifyOpts
                        GOOGLE_ANALYTICS : GOOGLE_ANALYTICS
                        SCHEMA           : require('smc-util/schema')
                        hash             : PRODMODE
                        BASE_URL         : base_url_html
                        PREFIX           : '../'
    ))

# the following renders the policy pages
for pp in (x for x in glob.sync('webapp-lib/policies/*.pug') when path.basename(x)[0] != '_')
    output_fn = "policies/#{misc.change_filename_extension(path.basename(pp), 'html')}"
    staticPages.push(new HtmlWebpackPlugin(
                        filename         : output_fn
                        date             : BUILD_DATE
                        title            : TITLE
                        theme            : theme
                        COMP_ENV         : COMP_ENV
                        components       : {}   # no data needed, empty is fine
                        inventory        : {}   # no data needed, empty is fine
                        template         : pp
                        chunks           : ['css']
                        inject           : 'head'
                        minify           : htmlMinifyOpts
                        GOOGLE_ANALYTICS : GOOGLE_ANALYTICS
                        hash             : PRODMODE
                        BASE_URL         : base_url_html
                        PREFIX           : '../'
    ))

# build pages for compute environment
if COMP_ENV
    components = JSON.parse(fs.readFileSync('webapp-lib/compute-components.json', 'utf8'))
    #console.log(JSON.stringify(Object.keys(components)))
    inventory  = JSON.parse(fs.readFileSync('webapp-lib/compute-inventory.json', 'utf8'))

    staticPages.push(new HtmlWebpackPlugin(
                        filename         : "doc/software.html"
                        date             : BUILD_DATE
                        title            : TITLE
                        theme            : theme
                        COMP_ENV         : COMP_ENV
                        components       : components
                        inventory        : inventory
                        template         : 'webapp-lib/doc/software.pug'
                        chunks           : ['css']
                        inject           : 'head'
                        minify           : htmlMinifyOpts
                        GOOGLE_ANALYTICS : GOOGLE_ANALYTICS
                        hash             : PRODMODE
                        BASE_URL         : base_url_html
                        PREFIX           : '../'
    ))

    for infn in glob.sync('webapp-lib/doc/software-*.pug')
        sw_env = path.basename(infn).split('-')[1].split('.')[0]
        output_fn = "doc/software-#{sw_env}.html"
        staticPages.push(new HtmlWebpackPlugin(
                        filename         : output_fn
                        date             : BUILD_DATE
                        title            : TITLE
                        theme            : theme
                        COMP_ENV         : COMP_ENV
                        components       : components
                        inventory        : inventory
                        sw_env           : sw_env
                        template         : infn
                        chunks           : ['css']
                        inject           : 'head'
                        minify           : htmlMinifyOpts
                        GOOGLE_ANALYTICS : GOOGLE_ANALYTICS
                        hash             : PRODMODE
                        BASE_URL         : base_url_html
                        PREFIX           : '../'
        ))


# global css loader configuration
cssConfig = JSON.stringify(minimize: true, discardComments: {removeAll: true}, mergeLonghand: true, sourceMap: false)

# this is like C's #ifdef for the source code. It is particularly useful in the
# source code of CoCalc's webapp, such that it knows about itself's version and where
# mathjax is. The version&date is shown in the hover-title in the footer (year).
setNODE_ENV         = new webpack.DefinePlugin
                                'process.env'     :
                                   'NODE_ENV'       : JSON.stringify(NODE_ENV)
                                'MATHJAX_URL'     : JSON.stringify(MATHJAX_URL)
                                'SMC_VERSION'     : JSON.stringify(SMC_VERSION)
                                'SMC_GIT_REV'     : JSON.stringify(GIT_REV)
                                'BUILD_DATE'      : JSON.stringify(BUILD_DATE)
                                'BUILD_TS'        : JSON.stringify(BUILD_TS)
                                'DEBUG'           : JSON.stringify(DEBUG)

# Writes a JSON file containing the main webpack-assets and their filenames.
{StatsWriterPlugin} = require("webpack-stats-plugin")
statsWriterPlugin   = new StatsWriterPlugin(filename: "webpack-stats.json")

# https://webpack.js.org/guides/migrating/#uglifyjsplugin-minimize-loaders
loaderOptions = new webpack.LoaderOptionsPlugin(
    minimize: true
    options:
        'html-minify-loader':
            empty                : true   # KEEP empty attributes
            cdata                : true   # KEEP CDATA from scripts
            comments             : false
            removeComments       : true
            minifyJS             : true
            minifyCSS            : true
            collapseWhitespace   : true
            conservativeCollapse : true   # absolutely necessary, also see above in module.loaders/.html
        #sassLoader:
        #    includePaths: [path.resolve(__dirname, 'src', 'scss')]
        #context: '/'
)

if cleanWebpackPlugin?
    # This is just a horrible hack for now, to get around how
    # slow the pug/static functionality is (remove this when use
    # of pug is deprecated in favor of react).
    plugins = [cleanWebpackPlugin]
else:
    plugins = []

plugins = plugins.concat([
    setNODE_ENV,
    banner,
    loaderOptions
])


if STATICPAGES
    plugins = plugins.concat(staticPages)
    entries =
        css  : 'webapp-css.coffee'
else
    # ATTN don't alter or add names here, without changing the sorting function above!
    entries =
        css  : 'webapp-css.coffee'
        fill : '@babel/polyfill'
        smc  : 'webapp-smc.coffee'
        # code splitting: we take all of our vendor code and put it in a separate bundle (vendor.min.js)
        # this way it will have better caching/cache hits since it changes infrequently
        vendor: [
            # local packages
            './webapp-lib/primus/primus-engine.min.js'
            # npm packages are added to vendor code separately in splitChunks config below
        ]
        'pdf.worker': './smc-webapp/node_modules/pdfjs-dist/build/pdf.worker.entry'
    plugins = plugins.concat([
        pug2app,
        mathjaxVersionedSymlink,
    ])

if DEVMODE
    console.log "******************************************************"
    console.log "WARNING! You might have to visit"
    console.log "     https://cocalc.com/[project_id]/port/[...]/app"
    console.log "in case the / static pages are currently not built via"
    console.log "     npm run webpack-static"
    console.log "******************************************************"
else
    plugins = plugins.concat(staticPages)

if PRODMODE
    # configuration for the number of chunks and their minimum size
    plugins.push new webpack.optimize.LimitChunkCountPlugin(maxChunks: 5)

plugins = plugins.concat([assetsPlugin, statsWriterPlugin])

UglifyJsPlugin = require('uglifyjs-webpack-plugin')
minimizer = new UglifyJsPlugin
    uglifyOptions:
        output:
            comments: new RegExp("This file is part of #{TITLE}","g") # to keep the banner inserted above

# tuning generated filenames and the configs for the aux files loader.
# FIXME this setting isn't picked up properly
if PRODMODE
    hashname = '[sha256:hash:base62:33].cacheme.[ext]' # don't use base64, it's not recommended for some reason.
else
    hashname = '[path][name].nocache.[ext]'
pngconfig   = "name=#{hashname}&limit=16000&mimetype=image/png"
svgconfig   = "name=#{hashname}&limit=16000&mimetype=image/svg+xml"
icoconfig   = "name=#{hashname}&mimetype=image/x-icon"
woffconfig  = "name=#{hashname}&mimetype=application/font-woff"

# publicPath: either locally, or a CDN, see https://github.com/webpack/docs/wiki/configuration#outputpublicpath
# In order to use the CDN, copy all files from the `OUTPUT` directory over there.
# Caching: files ending in .html (like index.html or those in /policies/) and those matching '*.nocache.*' shouldn't be cached
#          all others have a hash and can be cached long-term (especially when they match '*.cacheme.*')
if CDN_BASE_URL?
    publicPath = CDN_BASE_URL
else
    publicPath = path.join(BASE_URL, misc_node.OUTPUT_DIR) + '/'

if MEASURE
    BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
    bundleAnalyzerPlugin = new BundleAnalyzerPlugin({analyzerMode: 'static'})
    plugins = plugins.concat([bundleAnalyzerPlugin])

module.exports =
    cache: true

    # https://webpack.js.org/configuration/devtool/#devtool
    # **do** use cheap-module-eval-source-map; it produces too large files, but who cares since we are not
    # using this in production.  DO NOT use 'source-map', which is VERY slow.
    devtool: if SOURCE_MAP then '#cheap-module-eval-source-map'

    mode: if PRODMODE then 'production' else 'development'

    optimization:
        minimizer: [minimizer]

        splitChunks:
            cacheGroups:
                commons:
                    test: /[\\/]node_modules[\\/]/
                    name: 'vendor'
                    chunks: 'all'

    entry: entries

    output:
        path          : OUTPUT
        publicPath    : publicPath
        filename      : if PRODMODE then '[name]-[hash].cacheme.js' else '[name].nocache.js'
        chunkFilename : if PRODMODE then '[id]-[hash].cacheme.js'   else '[id].nocache.js'
        hashFunction  : 'sha256'

    module:
        rules: [
            { test: /pnotify.*\.js$/, use: "imports-loader?define=>false,global=>window" },
            {
                test: /\.(coffee|cjsx)$/
                use: [
                    { loader: 'babel-loader' },
                    { loader: 'coffee-loader' }
                ]
            },
            { test: [/node_modules\/prom-client\/.*\.js$/], loader: 'babel-loader' },
            { test: [/latex-editor\/.*\.jsx?$/], loader: 'babel-loader' },
            # Note: ts-loader is not a very good webpack citizen https://github.com/TypeStrong/ts-loader/issues/552
            # It just kind of does its own thing. See tsconfig.json for further congiration.
            { test: /\.tsx$/, loader: "babel-loader!ts-loader" },
            { test: /\.ts$/, loader: "ts-loader" },
            { test: /\.less$/,   use: ["style-loader", "css-loader", "less-loader?#{cssConfig}"] },
            { test: /\.scss$/,   use: ["style-loader", "css-loader", "sass-loader?#{cssConfig}"] },
            { test: /\.sass$/,   use: ["style-loader", "css-loader", "sass-loader?#{cssConfig}&indentedSyntax"] },
            { test: /\.png$/,    loader: "file-loader?#{pngconfig}" },
            { test: /\.ico$/,    loader: "file-loader?#{icoconfig}" },
            { test: /\.svg(\?[a-z0-9\.-=]+)?$/,    loader: "url-loader?#{svgconfig}" },
            { test: /\.(jpg|jpeg|gif)$/,    loader: "file-loader?name=#{hashname}"},
            { test: /\.html$/, include: [path.resolve(__dirname, 'smc-webapp')], use: ["raw-loader", "html-minify-loader?conservativeCollapse"]},
            { test: /\.hbs$/,    loader: "handlebars-loader" },
            { test: /\.woff(2)?(\?[a-z0-9\.-=]+)?$/, loader: "url-loader?#{woffconfig}" },
            { test: /\.ttf(\?[a-z0-9\.-=]+)?$/, loader: "url-loader?limit=10000&mimetype=application/octet-stream" },
            { test: /\.eot(\?[a-z0-9\.-=]+)?$/, loader: "file-loader?name=#{hashname}" },
            # ---
            { test: /\.css$/, use: ["style-loader", "css-loader?#{cssConfig}"]},
            { test: /\.pug$/, loader: 'pug-loader' },
        ]

    resolve:
        # So we can require('file') instead of require('file.coffee')
        extensions : ['.js', '.jsx', '.ts', '.tsx', '.json', '.coffee', '.cjsx', '.scss', '.sass']
        modules    : [path.resolve(__dirname),
                      path.resolve(__dirname, WEBAPP_LIB),
                      path.resolve(__dirname, 'smc-util'),
                      path.resolve(__dirname, 'smc-util/node_modules'),
                      path.resolve(__dirname, 'smc-webapp'),
                      path.resolve(__dirname, 'smc-webapp/node_modules'),
                      path.resolve(__dirname, 'node_modules')]

    plugins: plugins
