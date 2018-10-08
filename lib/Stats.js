'use strict';

var geoip = require('geoip-lite');

class Stats {
	constructor(rooms) {
		this.rooms = rooms;
		this.peerTimeData = [{x: new Date, y:0}];
		this.peerDeviceData = {};

		this.saveStatsTime = 60*60*12 //хранить историю только за последние 8 часов

		//start worker
		this.startWorker()
	}

	startWorker(){
		setInterval(()=> {
			this.processPeerDevices();
			this.processPeerTimeData();
		}, 6*1000)
	}

	processPeerDevices(){
		let data = Array.from(this.rooms, ([k,v]) => v);
		data.forEach((x) => {
			let peers = x._mediaRoom.peers
			peers.forEach(peer => {
				const device_name = peer.appData.device.name+" "+peer.appData.device.version
				this.peerDeviceData[device_name] = this.peerDeviceData[device_name] || [];
				let current = this.peerDeviceData[device_name];
				if (!current.includes(peer.name)){
					this.peerDeviceData[device_name].push(peer.name)
				}
			})
		})
	}

	processPeerTimeData(){
			const date = new Date;
			this.peerTimeData.push({x: date, y:this.peerCount})
			if (this.peerTimeData.length > (this.saveStatsTime)) this.peerTimeData.splice(0,1)
	}

	get peerCount() {
		let data = Array.from(this.rooms, ([k,v]) => v);
		let count = 0;
		data.forEach((x) => {
			count += x._mediaRoom.peers.length;
		})
		return count;
	}

	getRoomsData(){
		let data = Array.from(this.rooms, ([k,v]) => v);
		return data.map(x => {
	  	  let peers = x._mediaRoom.peers
		  return {
		  	roomId: x._roomId,
		  	peers: peers.map(p => {
		  		let producers = Array.from(p._producers, ([k,v]) => v);
		  		return  {
		  			name:p._internal.peerName,
		  			device:{
		  				name:p._appData.device.name,
		  				version:p._appData.device.version
		  			},
		  			producers: producers.map(producer => {
		  				if (!producer._data.transport.iceSelectedTuple){
			  				return  {
			  					type:producer._appData.source,
			  				}
			  			}
			  			let ip = producer._data.transport.iceSelectedTuple.remoteIP
			  			console.log(ip)
			  			var geo = geoip.lookup(ip) || {};
			  			console.log(geo)
			  			/*
			  				{ range: [ 3479297920, 3479301339 ],
							  country: 'US',
							  region: 'TX',
							  city: 'San Antonio',
							  ll: [ 29.4889, -98.3987 ],
							  metro: 641,
							  zip: 78218 }
			  			 */
		  				return {
		  					type:producer._appData.source,
		  					ice: {
		  						localIP:producer._data.transport.iceSelectedTuple.localIP,
		  						localPort: producer._data.transport.iceSelectedTuple.localPort,
		  						protocol: producer._data.transport.iceSelectedTuple.protocol,
		  						remoteIP: producer._data.transport.iceSelectedTuple.remoteIP,
		  						remotePort: producer._data.transport.iceSelectedTuple.remotePort,
		  						geoInfo: geo,
		  						state: producer._data.transport.iceState
		  					}
		  				}
		  			})
		  		}
		  	})
		  }
	  })
	}
}

module.exports = Stats;
