var util = require("util"),
  WebSocket = require('ws'),
  EVT = require('evrythng-extended'),
  mqtt = require('evrythng-mqtt');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

//0) Add the operator key of the account here, get it from:
// https://dashboard.evrythng.com/account
var OPERATOR_API_KEY = 'REPLACE_ME';
var thngToReceiveTtsEvents = 'UfsWsF95se5adXHnQsQ4Kbdm';


var ip = '192.168.50.153';
discoveryWs = new WebSocket('ws://' + ip + ':8887/manage');
eventWs = new WebSocket('ws://' + ip + ':8887/console');

connectToEvrythng(function (evt) {

  discoverTtsDevices(discoveryWs, function (resources) {
    console.log('Discovered TTS resources!');

    //1) Get data about the discovered resource
    // the "resources" variable contains the JSON of
    // all devices managed by TTS.

    //2) For the discovered TTS device we create a corresponding Thng
    // on EVRYTHNG, here is an example of how to create a Thng
    // (see: https://dashboard.evrythng.com/documentation/api/thngs)
    // Note: to check if the Thng exist before creating it use the
    // filter API with an Identifier. The Identifier should
    // be a unique ID given by the TTS.
    evt.thng().create({
      "name": "New Hue Lamp",
      "description": "A newly discovered Hue Lamp",
      "product": "Uf7tXyUK8epRmteD4eFnnh6q",
      "customFields": {
        "lastRepaired": "14. June 2014"
      },
      "identifiers": {
        "tts": "abc"
      },
      "properties": {
        "on": true,
        "power": 60,
        "level": 10
      },
      "tags": ["Demo", "Broadcom", "Hue", "thethingsystem"]
    }).then(function (thng) {
      console.log('A Thng was created on EVRYTHNG:');
      console.log(thng);

      // 3) We now listen for events related to all the properties of this Thng
      // on EVRYTHNG
      // see: https://dashboard.evrythng.com/documentation/sdks/evrythngmqttjs
      // and: https://dashboard.evrythng.com/documentation/api/properties
      var thngResource = evt.thng(thng.id);
      thngResource.property().subscribe(function(update){
        console.log('Got an update from EVRYTHNG');
        console.log(update);
        // 4) Do something with the update, e.g., send
        // a TTS command over WS.
      });
    });
  });

   //5) We also listen for events coming from TTS
   //(e.g., lamp turned on)
  listenForTtsEvents(eventWs, function (event) {
    console.log('Got a property update from TTS!');
    console.log(event);

    //6) Get data about the event resource
    // the "event" variable contains the JSON of
    // the last event.

    // 7) For each event on TTS we push the update to the Property of the
    // corresponding Thng on EVRYTHNG, e.g.,:
    var thng = evt.thng(thngToReceiveTtsEvents);
    thng.property('level').publish(randomInt(0, 100)).then(function () {
      console.log('Published a property update on EVRYTHNG!');
    });
  });

});

function discoverTtsDevices(discoveryWs, callback) {
  discoveryWs.onopen = function (event) {
    console.log('Discovering resources on TTS...');
    var json = JSON.stringify({
      path: '/api/v1/actor/list',
      requestID: '1',
      options: {depth: 'all'}
    });
    discoveryWs.send(json);
  };

  discoveryWs.onmessage = function (event) {
    var message = JSON.parse(event.data);
    if (message.requestID === '1') {
      // Discovery reply
      console.log('Discovered resources on TTS!');
      console.log(JSON.stringify(message, null, 2));
      callback(message);
      discoveryWs.close();
    }
  };

  discoveryWs.onclose = function (event) {
    console.log("Discovery socket closed on TTS: " + event.wasClean);
  };

  discoveryWs.onerror = function (event) {
    console.log("Socket error: " + util.inspect(event, {depth: null}));
    try {
      discoveryWs.close();
      console.log("Closed TTS Websocket.");
    } catch (ex) {
    }
  };
}

function listenForTtsEvents(eventWs, callback) {
  eventWs.onmessage = function (event) {
    var message = JSON.parse(event.data);
    //Ignore the frequent "manage" events
    if (!message.manage) {
      callback(message);
    }
  };
}

function connectToEvrythng(callback) {
  EVT.use(mqtt);
  var operator = new EVT.Operator(OPERATOR_API_KEY);
  callback(operator);
}

function randomInt (low, high) {
  return Math.floor(Math.random() * (high - low) + low);
}


process.on('SIGINT', function () {
  try {
    discoveryWs.close();
    eventWs.close();
    console.log("Closed Websockets!");
  } catch (ex) {
  }
  console.log('Bye, bye!');
});