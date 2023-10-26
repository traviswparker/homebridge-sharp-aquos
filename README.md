# homebridge-sharp-aquos
Homebridge plugin for Sharp Aquos TVs.  
Exposes TV accessories with power and input controls.  
TV will be unbridged, so you will have to add it manually in Home via + > Add Accessory > More options...

## Installation
Place the files in `node_modules/homenbridge-sharp-tv` and `npm install .`  
Or package it and install with npm:
```
tar -zcvf ../homebridge-sharp-tv.tar.gz .
cd ..
npm install homebridge-sharp-tv.tar.gz
```

## Sample Config
```
{
            "pollInterval": 60,
            "debugToInfo": false,
            "devices": [
                {
                    "name": "Sharp TV",
                    "ip": "10.0.0.41",
                    "defaultInputID": "1",
                    "inputs": [
                        {
                            "inputID": "1",
                            "name": "HDMI 1"
                        }
                    ]
                }
            ],
            "platform": "SharpTV"
}
```

## Control Center Remote

* Info maps to DISPLAY
* Play/Pause maps to MENU
* Back maps to RETURN
