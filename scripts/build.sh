#!/bin/bash

./node_modules/.bin/stylus \
	--use nib \
	--compress \
	--out build/development/css/main.css \
	src/stylus/main.styl 

# Build React JS
node_modules/.bin/browserify src/index.jsx \
	--extension=.jsx \
	--external classnames \
	--external immutable \
	--external react \
	--standalone BoschDoc \
	--transform [ babelify --plugins object-assign ] \
	--verbose > build/development/js/react-src.js

