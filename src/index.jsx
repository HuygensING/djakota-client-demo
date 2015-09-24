import React from "react";
import {DjatokaClient, Minimap, Zoom, FillButton, FreeMovementButton} from "hire-djatoka-client";

let configs = [
	{"identifier": "http://localhost:8080/jp2/13216268286407.jp2","imagefile": "/var/cache/tomcat6/temp/cache-4498671195057784867239412313.jp2","width": "546","height": "1012","dwtLevels": "4","levels": "4","compositingLayerCount": "1"},
	{"identifier": "http://localhost:8080/jp2/14290061920381.jp2","imagefile": "/var/cache/tomcat6/temp/cache17749998735895056360194398459.jp2","width": "846","height": "113","dwtLevels": "4","levels": "4","compositingLayerCount": "1"},
	{"identifier": "http://localhost:8080/jp2/13434696301791.jp2","imagefile": "/var/cache/tomcat6/temp/cache15069217286472590195734192754.jp2","width": "4355","height": "3300","dwtLevels": "6","levels": "6","compositingLayerCount": "1"},
	{"identifier": "http://localhost:8080/jp2/14109682675171.jp2","imagefile":"/var/cache/tomcat6/temp/cache-13181255252118942660168337691.jp2","width":"2409","height":"616","dwtLevels":"5","levels":"5","compositingLayerCount":"1"},
	{"identifier": "http://localhost:8080/jp2/14284083156311.jp2","imagefile":"/var/cache/tomcat6/temp/cache-8322632389065752716911482542.jp2","width":"758","height":"4891","dwtLevels":"6","levels":"6","compositingLayerCount":"1"},
	{"identifier": "http://localhost:8080/jp2/14259974659451.jp2", "imagefile": "/var/cache/tomcat6/temp/cache5770750747476906899831242319.jp2", "width": "710", "height": "65", "dwtLevels": "3", "levels": "3", "compositingLayerCount": "1"},
];

let service = "https://tomcat.tiler01.huygens.knaw.nl/adore-djatoka/resolver";

class App extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			config: configs[0]
		};
	}

	setMinimapDimensions(w, h) {
		document.querySelector(".minimap-wrap").style.width = w + 3 + "px";
		document.querySelector(".minimap-wrap").style.height = h + 3 + "px";
	}

	renderSample(i) {
		this.setMinimapDimensions(120, 120);
		this.setState({config: configs[i]});
	}

	renderSampleLinks() {
		let sampleLinks = [];
		for(let i = 0; i < configs.length; i++) {
			sampleLinks.push(
				<a key={i} onClick={this.renderSample.bind(this, i)}>{i+1}</a>
			);
		}
		return sampleLinks;
	}

	render() {
		return (
			<div className="app">
				<DjatokaClient config={this.state.config} service={service} />
				<div className="minimap-wrap">
					<Minimap config={this.state.config} service={service} onDimensions={this.setMinimapDimensions.bind(this)} />
				</div>
				<Zoom />		
				<FillButton scaleMode="widthFill"  />
				<FillButton scaleMode="heightFill"  />
				<FillButton scaleMode="fullZoom"  />
				<FillButton scaleMode="autoFill"  />
				<FreeMovementButton />
				{this.renderSampleLinks()}
			</div>
		);
	}
}

document.addEventListener("DOMContentLoaded", function(event) {
	React.render(<App />, document.body);
});