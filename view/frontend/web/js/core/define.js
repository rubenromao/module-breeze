(() => {
    'use strict';

    var modules = {},
        config = {
            paths: {},
            shim: {},
        },
        autoloadedBundles = {},
        bundlePrefixRe = /(?<prefix>Swissup_Breeze\/bundles\/\d+\/).*\.js$/,
        bundlePrefix = $('script[src*="/Swissup_Breeze/bundles/"]').attr('src')?.match(bundlePrefixRe).groups.prefix,
        suffixRe = /Swissup_Breeze\/.*?(core|main)(?<suffix>\.min\.js|\.js)$/,
        jsSuffix = $('script[src*="/Swissup_Breeze/"]')
            .filter((i, el) => el.src.includes('/core.') || el.src.includes('/main.'))
            .attr('src')
            .match(suffixRe).groups.suffix;

    function run() {
        if (this.ran || this.deps.some(dep => !dep.loaded)) {
            return this.result;
        }

        this.ran = true;
        this.result = this.cb?.apply(window, this.deps.map(dep => dep.run()));
        this.loaded = true;

        if (this.result === undefined && config.shim[this.name]?.exports) {
            this.result = window[config.shim[this.name].exports];
        }

        if (this.result?.component) {
            $.breezemap[this.result?.component] = this.result;
        } else if (this.result === undefined && $.breezemap.__get(this.name)) {
            this.result = $.breezemap.__get(this.name);
        }

        if ($.breeze.jsconfig[this.name]?.bundle && !autoloadedBundles[$.breeze.jsconfig[this.name].bundle]) {
            autoloadedBundles[$.breeze.jsconfig[this.name].bundle] = true;
            $(document).trigger('bundle:autoload', $.breeze.jsconfig[this.name].bundle);
        }

        if (this.result !== undefined && !(this.result instanceof $)) {
            [this.name].forEach(alias => {
                if (alias.endsWith('-orig')) {
                    alias = alias.slice(0, -5);
                } else {
                    alias = alias.startsWith('__module-') ? `__component${$.breezemap.__counter++}` : alias;
                }

                if ($.breezemap.__get(alias)) {
                    return;
                }

                $.breezemap[alias] = this.result;
            });
        }

        if (this.result === undefined && this.waitForResult) {
            this.ran = this.loaded = false;
            return this.result;
        }

        this.parents.forEach(parent => parent.run());

        return this.result;
    }

    function getModule(name, deps = [], parents = [], cb) {
        if (typeof parents === 'function') {
            cb = parents;
            parents = [];
        }

        modules[name] = modules[name] || {
            name,
            parents: [],
            deps: [],
            run
        };
        modules[name].cb = modules[name].cb || cb;
        modules[name].parents.push(...parents);
        modules[name].deps.push(...deps.map(depname => getModule(depname, [], [modules[name]])));

        if (!modules[name].path && $.breeze.jsconfig[name]) {
            modules[name].path = $.breeze.jsconfig[name].path;
        }

        return modules[name];
    }

    function collectDeps(alias, aliasAsPath, isKnown) {
        var result = [],
            path = aliasAsPath ? alias : $.breeze.jsconfig[alias]?.path || alias,
            imports = aliasAsPath ? [] : $.breeze.jsconfig[alias]?.import || [],
            index = imports.indexOf(alias),
            [bundle, lastIndex] = path.split('*'),
            dep;

        if (lastIndex) {
            lastIndex = parseInt(lastIndex, 10) || 0;
            bundle = bundlePrefix + bundle;
            path = bundle + (lastIndex || '');
            imports = imports.concat(_.range(0, lastIndex).map(i => bundle + (i || '')));
        }

        dep = getModule(alias);
        if (aliasAsPath && dep.path !== path) {
            dep = getModule(alias + '-orig');
        }

        imports.forEach((item, i) => {
            result.push(...collectDeps(item, i === index, true));
        });

        if (isKnown || $.breeze.jsconfig[dep.name]?.path) {
            dep.path = path;
        } else if (config.paths[alias] || alias.includes('//')) {
            dep.path = alias;
        } else {
            dep.unknown = true;
            dep.loaded = true;
        }

        result.push(dep);

        return result;
    }

    window.require = function (deps, cb) {
        var mod,
            depsWithImports = [],
            name = document.currentScript?.src.includes('Swissup_Breeze/bundles/') ?
                undefined : $(document.currentScript).data('name');

        if (typeof deps === 'string') {
            name = deps;
            deps = [];
        } else if (typeof deps === 'function') {
            cb = deps;
            deps = [];
        }

        if (modules[name]?.cb && cb) {
            name = `__module-${$.guid++}`;
        }

        mod = getModule(name || `__module-${$.guid++}`, deps, cb);
        deps.forEach(depname => depsWithImports.push(...collectDeps(depname)));
        depsWithImports = depsWithImports.filter(dep => !dep.loaded && dep.path);
        depsWithImports.forEach(dep => {
            if (dep.path.includes('//')) {
                if (dep.path.endsWith('.js') || dep.path.endsWith('/') || dep.path.includes('?')) {
                    dep.url = dep.path;
                } else {
                    dep.url = dep.path + '.js';
                }
            } else {
                dep.url = window.require.toUrl(dep.path);
            }
        });

        if (cb && cb.length && deps.length) {
            deps.some((depname, i) => {
                if (i >= cb.length) {
                    return true;
                }
                modules[depname] && (modules[depname].waitForResult = true);
            });
        }

        Promise.all(depsWithImports.map(dep => $.preloadScript(dep.url))).then(async () => {
            for (const dep of depsWithImports) {
                if (dep.name.startsWith('text!')) {
                    // @todo: load with ajax if not found in DOM
                    dep.ran = true;
                    dep.loaded = true;
                    dep.result = $('#' + dep.name.substr(5).replace(/[/.]/g, '_')).html();

                    continue;
                }

                await $.loadScript({
                    'src': dep.url,
                    'data-name': dep.name
                }, () => dep.run()).catch(e => console.error(e));
            }
        });

        return mod.run();
    };

    window.define = window.requirejs = window.require;
    window.require.toUrl = (path) => {
        if (config.paths[path]) {
            return config.paths[path];
        }

        if (path.includes('//')) {
            return path;
        }

        if (path.endsWith('.min')) {
            path += '.js';
        } else if (!path.endsWith('.min.js')) {
            path = path.replace(/\.js$/, '');
            path += jsSuffix;
        }

        return window.VIEW_URL + '/' + path;
    };
    window.require.config = (cfg) => $.extend(true, config, cfg || {});

    $(document).on('breeze:component:load', (e, data) => {
        setTimeout(() => getModule(data.alias).run(), 15);
    });
})();
