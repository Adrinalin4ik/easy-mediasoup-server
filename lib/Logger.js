'use strict';

const debug = require('debug');

const APP_NAME = 'mediasoup-server';

const SimpleNodeLogger = require('simple-node-logger')
const opts = {
        logFilePath:'./logs/medisoup.log',
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    }
const FileLogger = SimpleNodeLogger.createSimpleLogger( opts );

var rotatingLogStream = require('file-stream-rotator').getStream({
				filename:"./logs/medisaoup.log", 
				frequency:"1m", 
				verbose: false, 
				max_logs: "7d"
			});
	
class Logger
{
	constructor(prefix)
	{
		if (prefix)
		{
			this._debug = debug(`${APP_NAME}:${prefix}`);
			this._info = debug(`${APP_NAME}:INFO:${prefix}`);
			this._warn = debug(`${APP_NAME}:WARN:${prefix}`);
			this._error = debug(`${APP_NAME}:ERROR:${prefix}`);
		}
		else
		{
			this._debug = debug(APP_NAME);
			this._info = debug(`${APP_NAME}:INFO`);
			this._warn = debug(`${APP_NAME}:WARN`);
			this._error = debug(`${APP_NAME}:ERROR`);
		}

		/* eslint-disable no-console */
		this._debug.log = FileLogger.info.bind(rotatingLogStream)//= console.info.bind(console);
		this._info.log = FileLogger.info.bind(rotatingLogStream)//= console.info.bind(console);
		this._warn.log = FileLogger.warn.bind(rotatingLogStream)//= console.warn.bind(console);
		this._error.log = FileLogger.error.bind(rotatingLogStream)//= console.error.bind(console);
		/* eslint-enable no-console */
		this.info("Logger initialized", process.stderr)
		rotatingLogStream.on('rotate',(oldFile,newFile) => {
			this.error("Logger rotating")
	        // do something with old file like compression or delete older than X days. 
	    })
	}

	get debug()
	{
		return this._debug;
	}

	get info()
	{
		return this._info;
	}

	get warn()
	{
		return this._warn;
	}

	get error()
	{
		return this._error;
	}
}

module.exports = Logger;
