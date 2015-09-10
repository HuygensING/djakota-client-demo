#!/usr/bin/env node

var browserSync = require("browser-sync").create();
var modRewrite = require("connect-modrewrite");
var debounce = require("lodash.debounce");

var baseDir = "./build/development";
var watchFiles = [
	baseDir + "/js/*.js",
	baseDir + "/css/*.css",
	baseDir + "/img/*.png",
	baseDir + "/index.html"
];



var onFilesChanged = function(event, file) {
	if (event === "change") {
		browserSync.reload(file);
	}
};

browserSync.watch(watchFiles, debounce(onFilesChanged, 300));



browserSync.init({
	server: {
		baseDir: baseDir,
		middleware: [modRewrite([
			"^/img/(.*)$ /img/$1 [L]",
			"^/css/(.*)$ /css/$1 [L]",
			"^/js/(.*).js$ /js/$1.js [L]",
			"^/data/(.*).json$ /data/$1.json [L]",
			"^/?.*$ /index.html [L]"
		]), function(req, res, next) {
			if(req.originalUrl.match(/\.json$/)) {
				res.setHeader('Access-Control-Allow-Origin', '*');
				res.setHeader('Content-type', 'application/json; charset=utf-8');
			}
			next();
		}]
	}
});


