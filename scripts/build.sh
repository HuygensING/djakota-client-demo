#!/bin/bash

./node_modules/.bin/stylus \
	--use nib \
	--compress \
	--out build/development/css/main.css \
	src/stylus/main.styl 

# Build React JS
node_modules/.bin/browserify src/index.jsx \
	--extension=.jsx \
	--external react \
	--standalone DjatokaClientDemo \
	--transform [ babelify ] \
	--verbose > build/development/js/react-src.js

