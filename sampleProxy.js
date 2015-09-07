var util = require("util"),
    WebSocket = require('ws'),
    EVT = require('evrythng-extended'),
    mqtt = require('evrythng-mqtt');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

//Evrythng wrapper
var evrythng = null;

//TTS wrappers
var manageWS = null;
var consoleWS = null;


// Last updates in either direction in order to avoid duplicates as the thing system does not return the timestamps when
// updating values
var lastTTSPropertyUpdate = {};
var lastEVTPropertyUpdate = {};

// Add the operator key of the account here, get it from: https://dashboard.evrythng.com/account
var OPERATOR_API_KEY = '';

//ADD the TTS ip address
var ip = '';

//Connect to EVRYTHNG Platform
function connectToEVRYTHNG() {

    // Enable MQTT
    EVT.use(mqtt);

    //Create the EVRYTHNG Wrapper
    evrythng = new EVT.Operator(OPERATOR_API_KEY); //Wrapper to access the EVRYTHNG PLATFORM
}

//Connecto to TTS Platform (manage endpoint and console endpoint)
function connectoToTTS() {

    manageWS = new WebSocket('ws://' + ip + ':8887/manage');

    manageWS.onopen = function (event) {
        console.log('[TTS] Manage connected');

        //Discover devices once connected
        discoverTTSDevices();
    };

    manageWS.onmessage = function (event) {
        var message = JSON.parse(event.data);

        if (message.requestID === '1') {
            processDiscoveredDevices(message);
        }

        if (message.requestID === '2') {
            console.log('[TTS] Action sent!!');
        }

        if (message.requestID === '3') {
            console.log('[TTS] Property updated!!');
        }
    };

    manageWS.onclose = function (event) {
        console.log("[TTS] Manage socket closed on TTS: " + event.wasClean);
    };

    manageWS.onerror = function (event) {
        console.log("[TTS] Socket error: " + util.inspect(event, {depth: null}));
        try {
            manageWS.close();
            console.log("[TTS] Closed TTS Websocket.");
        } catch (ex) {
        }
    };

    consoleWS = new WebSocket('ws://' + ip + ':8887/console');

    consoleWS.onopen = function (event) {
        console.log("[TTS] TTS Console connected");
    };

    consoleWS.onmessage = function (event) {
        var message = JSON.parse(event.data);

        if (message['.updates']) {

            //We filter here for the device, the HUE bulb type
            if (message['.updates'][0].whatami === '/device/lighting/hue/bulb') {
                console.log('[TTS] HUE update message received');

                //To avoid duplicates we check the last update, if it is the same we do not forward
                if (compareUpdates(lastTTSPropertyUpdate, message['.updates'][0])) {
                    console.log("[TTS] Proceed to forward to EVT...");

                    lastEVTPropertyUpdate = message['.updates'][0].info;
                    lastEVTPropertyUpdate.status = message['.updates'][0].status;

                    sendUpdateToEVRYTHNG(message['.updates'][0]);
                } else {
                    console.log('[TTS] Ignoring update, already processed');
                }
            }
            ;
        }
    };

    consoleWS.onclose = function (event) {
        console.log("Console socket closed on TTS: " + event.wasClean);
    };

    consoleWS.onerror = function (event) {
        console.log("Socket error: " + util.inspect(event, {depth: null}));
        try {
            consoleWS.close();
            console.log("Closed TTS Websocket.");
        } catch (ex) {
        }
    };
}

//Utility function to check if the properties of the HUE changed
function compareUpdates(previous, current) {
    console.log("[TTS] Comparing updates " + JSON.stringify(previous) + " " + JSON.stringify(current));
    if (
        (previous.brightness != current.info.brightness) ||
        (previous.status != current.status) ||
        (previous.color.cie1931.x != current.info.color.cie1931.x) ||
        (previous.color.cie1931.y != current.info.color.cie1931.y)
    ) {
        console.log("[TTS] At least one value has changed, forwarding needed");
        return true;
    }
    else {
        console.log("[TTS] No updates found, no need to forward");
        return false;
    }
}

//Utility function to check if the property update on the HUE received from EVT is an actual change and needs forwarding
function checkProperty(previous, property) {
    console.log("[EVT] Checking if property " + property.key + " changed to " + property.value + " " + JSON.stringify(previous));

    if (previous[property.key]) {
        console.log("[EVT] Property present");
        if (previous[property.key] === property.value) {
            console.log("[EVT] Same value, no need to forward");
            return false;
        }
        else if ((property.key === 'x') || (property.key === 'y')) {
            console.log("[EVT] Checking x, y values from Hue");
            if (previous.color.cie1931[property.key] === property.value) {
                console.log("[EVT] Same value, no need to forward");
                return false;
            }
        }
    }
    return true;
}

//Defines what to do when a HUE Bulb is discovered
function processHueBulb(deviceId, device) {

    //Check if the thng already exists in EVRYTHNG by using the TTS deviceId as an identifier
    var filterString = 'identifiers.tts=' + deviceId;
    evrythng.thng().read({
        params: {
            filter: filterString
        }
    }).then(function (thngs) {
        if (thngs.length > 0) {
            console.log('[EVT] Thng already exists, skipping creation');
        }
        else {
            // For the discovered TTS device we create a corresponding Thng
            // on EVRYTHNG, here is an example of how to create a Thng
            // (see: https://dashboard.evrythng.com/documentation/api/thngs)
            console.log('[EVT] Creating thng');
            evrythng.thng().create({
                name: device.name,
                description: "A newly discovered " + device.whatami,
                product: 'Uf7tXyUK8epRmteD4eFnnh6q',
                /*"customFields": {
                 "tts": "14. June 2014"
                 },*/
                identifiers: { //This is needed to avoid double creation
                    tts: deviceId
                },
                properties: {
                    status: device.status,
                    model: device.info.color.model,
                    x: device.info.color[device.info.color.model].x,
                    y: device.info.color[device.info.color.model].y,
                    brightness: device.info.brightness,
                    updated: Date.parse(device.updated)
                },
                tags: ['Demo', 'Broadcom', 'Hue', 'thethingsystem']
            }).then(function (thng) {
                console.log('[EVT] A new thng was created on EVRYTHNG:');
            });
        }
    });
}

// Checks the discovered resources from TTS and reacts accordingly.
// Only filters for HUE bulbs so far
function processDiscoveredDevices(resources) {
    console.log('[TTS] Discovered TTS resources!');

    for (var deviceId in resources.result.devices) {
        var device = resources.result.devices[deviceId];

        //Filter for the desired devices (Hue Lamp)
        if (device.whatami == "/device/lighting/hue/bulb") {
            console.log("Found HUE Bulb!: " + deviceId);
            processHueBulb(deviceId, device);
        }
    }
}

//Send discovery command to TTS
function discoverTTSDevices() {
    console.log('[TTS] Discovering resources on TTS...');
    var json = JSON.stringify({
        path: '/api/v1/device/list',
        requestID: '1',
        options: {depth: 'all'}
    });
    manageWS.send(json);
}

//Send action command to TTS
function sendActionToTTS(thng, action) {
    console.log("[TTS] TTS Sending action");
    var json = JSON.stringify({
        path: '/api/v1/device/perform/' + thng.identifiers.tts.split('/')[1],
        requestID: '2',
        perform: action.type.slice(1)
    });
    manageWS.send(json);
}

//Send property update to EVRYTHNG
function sendUpdateToEVRYTHNG(update) {

    //We need to match the TTS device with the EVRYTHNG thng via the identifier
    var filterString = 'identifiers.tts=' + update.whoami;
    evrythng.thng().read({
        params: {
            filter: filterString
        }
    }).then(function (thngs) {
            console.log("[EVT] Updating properties " + thngs[0].id);

            //We update all the properties, as the thing system broadcast the whole structure, we use their timestamp to sync
            var propertiesUpdate = [{
                key: 'status',
                value: update.status,
                timestamp: update.updated
            },
                {
                    key: 'brightness',
                    value: update.info.brightness,
                    timestamp: update.updated
                },
                {
                    key: 'x',
                    value: update.info.color[update.info.color.model].x,
                    timestamp: update.updated
                },
                {
                    key: 'y',
                    value: update.info.color[update.info.color.model].x,
                    timestamp: update.updated
                }
            ];

            thngs[0].property().update(propertiesUpdate).then(function (thngs) {
                console.log('[EVT] Properties updated');
            });
        }
    );
}

//Sends a property update to TTS. EVRYTHNG can handle individual properties, while TTS sends the whole structure so
//we map it here
function sendPropertyToTTS(thng, property) {
    console.log('[TTS] Sending property update');

    evrythng.thng(thng.id).read().then(function (thngRead) {

        var propertyUpdates = {
            status: thngRead.properties.status,
            color: {
                model: thngRead.properties.model,
                cie1931: {
                    x: thngRead.properties.x,
                    y: thngRead.properties.y
                }
            },
            brightness: thngRead.properties.brightness
        };

        //Save the last update to avoid duplicates
        lastTTSPropertyUpdate = propertyUpdates;

        var json = JSON.stringify({
            path: '/api/v1/device/perform/' + thng.identifiers.tts.split('/')[1],
            requestID: '3',
            perform: thngRead.properties.status,
            parameter: JSON.stringify(propertyUpdates)
        });

        manageWS.send(json);
    });
}

function subscribeToThng(thng){
    console.log("[EVT] Subscribing to properties from " + thng.id);
    thng.property().subscribe(function (update) {
        console.log("[EVT] Property update notification" + JSON.stringify(update[0]));

        //only check individual updates for simplicity, many updates will come from the TTS proxy updates,
        // which have to be ignored anyway to avoid duplicates
        if (update.length === 1) {
            if (checkProperty(lastEVTPropertyUpdate, update[0])) {
                console.log('[EVT] Forwarding update to TTS');
                sendPropertyToTTS(thng, update[0]);
            } else {
                console.log("[EVT] Ignoring update, already processed");
            }
        }else{
            console.log("[EVT] Ignoring multiple updates coming from proxy, already processed");
        }
    });

    console.log("[EVT] Subscribing to actions from " + thng.id);
    thng.action('all').subscribe(function (update) {
        console.log('[EVT] Action update');
        sendActionToTTS(thng, update);
    });
}

//Register to events in the EVRYTHNG platform for the corresponding thngs
function listenForEVRYTHNGEvents() {
    //We search for the TTS enabled thngs based on the identifiers
    var filterString = 'identifiers.tts=*';
    evrythng.thng().read({
        params: {
            filter: filterString
        }
    }).then(function (thngs) {

        thngs.forEach(function (thng) {
            subscribeToThng(thng);
        });
    });
}

function startProxy() {

    //Connect to EVRYTHNG
    connectToEVRYTHNG();

    //Connect to TTS (when connected discovery and subscription to console are launched)
    connectoToTTS();

    //Registers to events from all the TTS thngs in EVRYTHNG
    listenForEVRYTHNGEvents();
}

startProxy();

process.on('SIGINT', function () {
    try {
        manageWS.close();
        consoleWS.close();
        console.log("Closed Websockets!");
    } catch (ex) {
    }
    console.log('Bye, bye!');
    process.exit(0);
});