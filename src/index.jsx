import React from "react";
import {DjatokaClient, Minimap, Zoom, FillButton} from "hire-djatoka-client";

let configs = [
	{"identifier": "http://localhost:8080/jp2/13434696301791.jp2","imagefile": "/var/cache/tomcat6/temp/cache15069217286472590195734192754.jp2","width": "4355","height": "3300","dwtLevels": "6","levels": "6","compositingLayerCount": "1"},
	{"identifier":"http://localhost:8080/jp2/14109682675171.jp2","imagefile":"/var/cache/tomcat6/temp/cache-13181255252118942660168337691.jp2","width":"2409","height":"616","dwtLevels":"5","levels":"5","compositingLayerCount":"1"},
	{"identifier":"http://localhost:8080/jp2/14284083156311.jp2","imagefile":"/var/cache/tomcat6/temp/cache-8322632389065752716911482542.jp2","width":"758","height":"4891","dwtLevels":"6","levels":"6","compositingLayerCount":"1"}
];

let service = "https://tomcat.tiler01.huygens.knaw.nl/adore-djatoka/resolver";

class App extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			config: configs[0]
		};
	}

	render() {
		return (
			<div className="app">
				<DjatokaClient config={this.state.config} service={service} />
				<Zoom />		
				<FillButton scaleMode="widthFill"  />
				<FillButton scaleMode="heightFill"  />
				<FillButton scaleMode="fullZoom"  />
				<FillButton scaleMode="autoFill"  />
				<Minimap config={this.state.config} service={service} />
			</div>
		);
	}
}

document.addEventListener("DOMContentLoaded", function(event) {
	React.render(<App />, document.body);
});