const { Telnet } = require('telnet-client');

const pluginName = 'homebridge-sharp-tv';
const platformName = 'SharpTV';
const pluginVersion = '2.9.0';

const defaultPollingInterval = 3;
const infoRetDelay = 250;
const defaultTrace = false;
const autoDiscoverTime = 3000;
const setAVRState = false;
/* Setup settings button and info button */

let Service;
let Characteristic;
let Accessory;
let UUIDGen;

var traceOn;
var debugToInfo;
var discoverDev;
var g_log;

var foundtvs = [];
var cachedAccessories = [];

var didFinishLaunching = false;

/* Variables for telnet polling system */
var g_powerState = [false,false,false];
var g_volLevel = [0,0,0];
var g_muteState = [false,false,false];
var g_inputID = [null,null,null];

module.exports = (homebridge) => {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.platformAccessory;
	UUIDGen = homebridge.hap.uuid;

	homebridge.registerPlatform(pluginName, platformName, sharpClient, true);
};

exports.logDebug = function(string) {
	if (!debugToInfo)
		g_log.debug(string);
	else 
		g_log.warn(string);
}
function logDebug(string) {
	if (!debugToInfo)
		g_log.debug(string);
	else 
		g_log.warn(string);
}

class sharpClient {
	constructor(log, config, api) {
		g_log = log;
		this.port = 10002;
		this.api = api;

		/* Stop loading if plugin is not configured */
		if (!config || (!Array.isArray(config.devices) && !Array.isArray(config.volumeControl))) {
			g_log.warn("WARNING: No config settings found for homebridge-sharp-tv plugin.")
			return;
		}

		traceOn = config.debugTrace || defaultTrace;

		debugToInfo = config.debugToInfo || false;

		/* Search for all available Denon tvs */

		api.on('didFinishLaunching', function() {
			logDebug("DidFinishLaunching");
			didFinishLaunching = true;

			this.configTVs = [];

			try {
				for (let i in config.devices) {
					if (config.devices[i].ip !== undefined && !this.configTVs[config.devices[i].ip])
						this.configTVs[config.devices[i].ip] = new tv(this, config, config.devices[i].ip);
				}
			} catch {
				g_log.error("ERROR: Could not setup devices")
				return;
			}
			setTimeout(this.removeCachedAccessory.bind(this), autoDiscoverTime+5000);
		}.bind(this));
	}

	configureAccessory(platformAccessory){
		if (traceOn) {
			logDebug('DEBUG: configureAccessory');
			try {
				logDebug(platformAccessory.displayName);
			} catch {
			}
		}

		cachedAccessories.push(platformAccessory);
	}

	removeCachedAccessory(){
		if (traceOn) {
			logDebug('DEBUG: removeCachedAccessory');
			try {
				for (let i in cachedAccessories) 
					logDebug(cachedAccessories[0].displayName);
			} catch {
			}
		}

		try {
			this.api.unregisterPlatformAccessories(pluginName, platformName, cachedAccessories);
		} catch {
			g_log.error("ERROR: Could not unregister accessories.");
		}
	}
}

class tv {
	constructor(base, config, ip) {
		this.port = 10002;
		this.api = base.api;
		this.ip = ip;
		this.base = base;
		this.queue = [];
		this.last_command=null;

		this.tvAccessories = [];
		this.legacyAccessories = [];
		this.volumeAccessories = [];

		this.switches = config.switches;
		this.devices = config.devices;
		this.volumeControl = config.volumeControl;

		this.devicesDuplicates = [];
		this.switchesDuplicates = [];
		this.volumeCtrlDuplicates = [];

		g_log.info('Start tv with ip: ' + this.ip);

		this.pollingInterval = config.pollInterval || defaultPollingInterval;
		this.pollingInterval = this.pollingInterval * 1000;

		this.htmlControl = false;
		this.telnetPort = 10002;
		this.devInfoSet = false;
		this.controlProtocolSet = false;
		this.telnet = null;

		this.manufacturer = 'Sharp';
		this.modelName = pluginName;
		this.serialNumber = 'Aquos';
		this.firmwareRevision = pluginVersion;

		this.disabletv = false;
		this.pollingTimeout = false;
		this.usesManualPort = false;

		this.webAPIPort = null;
		this.checkAliveInterval = null;

		this.zTwoEn = false;
		this.zThreeEn = false;

		this.poweredOn = [false,false,false];
		this.currentInputID = [null,null,null];
		this.volDisp = [null,null,null];
		this.volumeLevel = [30,30,30];
		this.muteState = [false,false,false];

		this.getPortSettings();
		this.startConfiguration();
	}

	getDevInfoSet() {
		return this.devInfoSet;
	}
	setDevInfoSet(set) {
		this.devInfoSet = set;
	}
	returnIP() {
		return this.ip;
	}
	returnPort() {
		return this.webAPIPort;
	}
	hasManualPort() {
		return this.usesManualPort;
	}
	setDisabletv(set) {
		g_log.error('ERROR: tv with IP: ' + this.ip + " is disabled. Can't connect through http or Telnet.")
		this.disabletv = set;
	}

	getPortSettings() {

			this.htmlControl = false;
			logDebug('DEBUG: Manual control through Telnet set: ' + this.ip);
			this.controlProtocolSet = true;
	}

	/* 
	 * Try configure the devices. Wait until tv discovery is finished.
	 */
	startConfiguration () {
		if (this.disabletv)
			return;

		if ( !didFinishLaunching) {
			setTimeout(this.startConfiguration.bind(this), infoRetDelay);
			return;
		}

		/* Configure devices */
		for (let i in this.devices) {
			if (this.devices[i].ip === this.ip) {
				try {
					if (this.devicesDuplicates[this.devices[i].name]) {
						g_log.warn("WARNING: A Device with the name: %s and ip: %s is already added. It will be ignored.", this.devices[i].name, this.devices[i].ip);
						continue;
					} else {
						this.devicesDuplicates[this.devices[i].name] = true;
						this.tvAccessories.push(new tvClient(this, this.devices[i]));
					}
				} catch {
					g_log.error("ERROR: Could not add TV accessory.");
				}
			}
		}

		/* start the polling */
		setTimeout(this.startPolling, Math.random() * 3000, this);
	}

	/*
	 * Diverted start of polling loop.
	 */
	startPolling (that) {
		if (!that.checkAliveInterval) {
			that.checkAliveInterval = setInterval(that.pollForUpdates.bind(that, 1), that.pollingInterval);
		}
	}

	/*
	 * This will start a polling loop that goes on forever and updates
	 * the on characteristic periodically.
	 */
	pollForUpdates(zone) {
		if (!this.controlProtocolSet)
			return;

		// if (traceOn)
		// 	logDebug('DEBUG: pollForUpdates zone: ' + zone + ': ' + this.ip);

		/* Make sure that no poll is happening just after switch in input/power */
		if (this.pollingTimeout) {
			this.pollingTimeout = false;
			return;
		}

		var that = this;
		this.send('POWR?   ');
		this.send('IAVD?   ');
		this.send('RSPW2   '); //ensure TV can be turned on from IP control

	}


	/*
	 * Used to update the state of all. Disable polling for one poll.
	 */
	updateStates(that, stateInfo, curName) {
		if (curName)
			that.pollingTimeout = true;

		if (traceOn)
			logDebug(stateInfo);

		if (stateInfo.power === true || stateInfo.power === false)
			that.poweredOn[stateInfo.zone-1] = stateInfo.power;

		if (stateInfo.inputID)
			that.currentInputID[stateInfo.zone-1] = stateInfo.inputID;

		for (let i in that.tvAccessories) {
			if (that.tvAccessories[i].getName() != curName) {
				that.tvAccessories[i].settvState(stateInfo);
			}
		}
	}

	/*
	 * Setup Telnet connection if no HTML control is possible.
	 */
       connect() {
		this.telnet = new Telnet();
		const params = {
		  host: this.ip,
		  port: 10002,
		  negotiationMandatory: false,
		  timeout: 1500,
		  ors: '\r',
		  irs: '\r',
		  shellPrompt: null
		}
		this.telnet.connect(params).then( 
			res => { logDebug('Connected to '+this.ip) }).catch( 
			error => { logDebug(error) } 
		);
      }

      send(cmd) {
		if (this.telnet == null)
		this.connect();
	        this.telnet.send(cmd).then(
			res => { this.responseHandler(cmd,res.slice(0, -1)) }).catch(
			error => { 
				logDebug(error);
				this.telnet=null;
			} 
		);
      }

      responseHandler(cmd,res) {

            logDebug('Received response for ' + cmd + res);
	    res=res.split('\r')
            switch (cmd) {
                case 'POWR?   ':
    		case 'IAVD?   ':
			if (res[0] === '1')
				g_powerState[0] = true;
			else if (res[0] === '0')
				g_powerState[0] = false;
			let stateInfo = {
				zone: 1,
				power: g_powerState[0],
				inputID: res[1],
			}
			logDebug(stateInfo);
			if (!this.pollingTimeout)
				this.updateStates(this, stateInfo, null);
			this.telnet.end().then( () => { this.telnet = null; } )

		break;
        }
    }
}

class tvClient {
	constructor(recv, device) {
		this.port = 3000;
		this.api = recv.api;
		this.recv = recv;

		this.tvServicePort = recv.webAPIPort;

		this.manufacturer = recv.manufacturer;
		this.modelName = recv.modelName;
		this.serialNumber = recv.serialNumber;
		this.firmwareRevision = recv.firmwareRevision;

		// configuration
		this.name = device.name || 'Denon tv';
		this.ip = device.ip;
		this.inputs = device.inputs;
		this.zone = device.zone || 1;
		if (this.zone < 1 || this.zone > 3)
			this.zone = 1;

		if (this.zone == 2)
			this.recv.zTwoEn = true;
		if (this.zone == 3)
			this.recv.zThreeEn = true;

		this.iterator = this.zone - 1;
		this.defaultVolume = {};

		this.defaultInputID = device.defaultInputID;

		/* setup variables */
		this.inputIDSet = false;
		this.inputIDs = new Array();

		this.setDefaultInputTimeout;

		/* Delay to wait for retrieve device info */
		this.setupTvService();
	}


	/*****************************************
	 * Start of TV integration service 
	 ****************************************/
	setupTvService() {
		if (traceOn)
			logDebug('DEBUG: setupTvService zone: ' + this.zone + ': ' + this.name);

		this.tvAccesory = new Accessory(this.name, UUIDGen.generate(this.ip+this.name+"tvService"));
		this.tvAccesory.category = this.api.hap.Categories.TELEVISION;

		this.tvService = new Service.Television(this.name, 'tvService');
		this.tvService
			.setCharacteristic(Characteristic.ConfiguredName, this.name);
		this.tvService
			.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
		this.tvService
			.getCharacteristic(Characteristic.Active)
			.on('get', this.getPowerState.bind(this))
			.on('set', this.setPowerState.bind(this));
		this.tvService
			.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('set', (inputIdentifier, callback) => {
				this.setAppSwitchState(true, callback, this.inputIDs[inputIdentifier]);
			})
			.on('get', this.getAppSwitchState.bind(this));
		this.tvService
			.getCharacteristic(Characteristic.RemoteKey)
			.on('set', this.remoteKeyPress.bind(this));
		this.tvAccesory
			.getService(Service.AccessoryInformation)
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.modelName)
			.setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
			.setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision);

		this.tvAccesory.addService(this.tvService);

		this.setupInputSourcesService();


		logDebug('DEBUG: publishExternalAccessories: '+ this.name);
		this.api.publishExternalAccessories(pluginName, [this.tvAccesory]);
	}


	setupInputSourcesService() {
		if (traceOn)
			logDebug('DEBUG: setupInputSourcesService: ' + this.name);
		if (this.inputs === undefined || this.inputs === null || this.inputs.length <= 0) {
			return;
		}

		if (Array.isArray(this.inputs) === false) {
			this.inputs = [this.inputs];
		}

		let savedNames = {};

		this.inputs.forEach((value, i) => {

			// get inputID
			let inputID = null;

			if (value.inputID !== undefined) {
				inputID = value.inputID;
			} else {
				inputID = value;
			}

			// get name
			let inputName = inputID;

			if (savedNames && savedNames[inputID]) {
				inputName = savedNames[inputID];
			} else if (value.name) {
				inputName = value.name;
			}

			this.defaultVolume[inputID] = 0
			if (value.defaultVolume !== undefined) {
				this.defaultVolume[inputID] = value.defaultVolume;
			}

			// if inputID not null or empty add the input
			if (inputID !== undefined && inputID !== null && inputID !== '') {
				inputID = inputID.replace(/\s/g, ''); // remove all white spaces from the string

				let tempInput = new Service.InputSource(inputID, 'inputSource' + i);
				tempInput
					.setCharacteristic(Characteristic.Identifier, i)
					.setCharacteristic(Characteristic.ConfiguredName, inputName)
					.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
					.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
					.setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);

				tempInput
					.getCharacteristic(Characteristic.ConfiguredName)
					.on('set', (name, callback) => {
						savedNames[inputID] = name;
						callback()
					});

				this.tvAccesory.addService(tempInput);
				if (!tempInput.linked)
					this.tvService.addLinkedService(tempInput);
				this.inputIDs.push(inputID);
			}

		});
	}
	/*****************************************
	* End of TV integration service 
	****************************************/


	/*****************************************
	 * Start of helper methods
	 ****************************************/
	updatetvState(tvStatus) {
		if (!tvStatus) {
			if (this.powerService) 
				this.powerService
					.getCharacteristic(Characteristic.On)
					.updateValue(false);
			if (this.tvService) 
				this.tvService
					.getCharacteristic(Characteristic.Active)
					.updateValue(false); //tv service
		} else {
			if (this.powerService) 
				this.powerService
					.getCharacteristic(Characteristic.On)
					.updateValue(true);
			if (this.tvService)
				this.tvService
					.getCharacteristic(Characteristic.Active)
					.updateValue(true); //tv service
		}
	}

	settvState(stateInfo) {
		if (this.zone != stateInfo.zone)
			return;

		if (traceOn && setAVRState)
			logDebug('DEBUG: settvState zone: ' + this.name);
		if (stateInfo.power === true || stateInfo.power === false)
			this.updatetvState(this.recv.poweredOn[this.iterator]);

		if (stateInfo.inputID) {
			if (this.recv.poweredOn[this.iterator]) {
				let inputName = stateInfo.inputID;
				for (let i = 0; i < this.inputIDs.length; i++) {
					if (inputName === this.inputIDs[i]) {
						if (this.inputIDSet === false)
							this.tvService
								.getCharacteristic(Characteristic.ActiveIdentifier)
								.updateValue(i);
						else
							this.inputIDSet = false;
					}
				}
			}
		}
	}
	/*****************************************
	 * End of helper methods
	 ****************************************/

 	/*****************************************
	 * Start of Homebridge Setters/Getters
	 ****************************************/
	getPowerState(callback) {
		if (traceOn)
			logDebug('DEBUG: getPowerState zone: ' + this.zone + ': ' + this.name);

		callback(null, this.recv.poweredOn[this.iterator] ? 1 : 0);
	}

	setPowerState(state, callback) {
		if (traceOn)
			logDebug('DEBUG: setPowerState zone: ' + this.zone + 'state: ' + this.name);

		if (state === 0)
			state = false;
		else if (state === 1)
			state = true;
			var stateString;
			if (this.zone == 1)
				stateString = 'POWR' + (state ? '1   ' : '0   ');
			this.recv.send(stateString); 
			/* Update possible other switches and accessories too */
			let stateInfo = {
				zone: this.zone,
				power: state,
				inputID: null,
				masterVol: null,
				mute: null
			}
			this.recv.updateStates(this.recv, stateInfo, this.name);

			callback();
	}


	getAppSwitchState(callback) {
		if (traceOn)
			logDebug('DEBUG: getAppSwitchState zone: ' + this.zone);

		if (this.recv.poweredOn[this.iterator]) {
			let inputName = this.recv.currentInputID[this.iterator];
			for (let i = 0; i < this.inputIDs.length; i++) {
				if (inputName === this.inputIDs[i]) {
					this.tvService
						.getCharacteristic(Characteristic.ActiveIdentifier)
						.updateValue(i);
						callback(null, i);
						return;
				}
			}
		}
		callback(null, 0);
	}

	setAppSwitchState(state, callback, inputName) {
		if (traceOn)
			logDebug('DEBUG: setAppSwitchState zone: ' + this.zone + ': ' + this.name);

		this.inputIDSet = true;

		var level = this.defaultVolume[inputName];

		var inputString;
		let inputNameN = inputName.replace('/', '%2F');
		if (this.zone == 1) {
			inputString = 'IAVD' + inputNameN+'   ';
		} 

		var that = this;



		that.recv.send(inputString);

		/* Update possible other switches and accessories too */
		let stateInfo = {
			zone: that.zone,
			power: that.recv.poweredOn[that.iterator],
			inputID: inputName
		}
		that.recv.updateStates(that.recv, stateInfo, that.name);

		callback();
	}

	remoteKeyPress(remoteKey, callback) {
		var ctrlString = '';

		switch (remoteKey) {
			case Characteristic.RemoteKey.INFORMATION:
				ctrlString = ''
				break;
		}

		if (ctrlString != '' && this.recv.poweredOn[this.iterator]) {
				this.recv.send(ctrlString);
		}
		callback();
	}

	getName() {
		return this.name;
	}
	/*****************************************
	* End of Homebridge Setters/Getters
	****************************************/
}
