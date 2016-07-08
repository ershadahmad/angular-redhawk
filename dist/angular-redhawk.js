     /*!                                                                                           
      * This file is protected by Copyright. Please refer to the COPYRIGHT file                    
      * distributed with this source distribution.                                                 
      *                                                                                            
      * This file is part of Angular-REDHAWK angular-redhawk.                                              
      *                                                                                            
      * Angular-REDHAWK angular-redhawk is free software: you can redistribute it and/or modify it         
      * under the terms of the GNU Lesser General Public License as published by the               
      * Free Software Foundation, either version 3 of the License, or (at your                     
      * option) any later version.                                                                 
      *                                                                                            
      * Angular-REDHAWK angular-redhawk is distributed in the hope that it will be useful, but WITHOUT     
      * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or                      
      * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public License               
      * for more details.                                                                          
      *                                                                                            
      * You should have received a copy of the GNU Lesser General Public License                   
      * along with this program.  If not, see http://www.gnu.org/licenses/.                        
      *                                                                                            
      * angular-redhawk - v1.1.0 - 2016-07-08          
      */                                                                                           
     angular.module('redhawk', ['redhawk.rest', 'redhawk.util', 'redhawk.sockets', 'redhawk.directives'])
  .config(['$httpProvider', function($httpProvider) {
    $httpProvider.defaults.transformResponse.unshift(function(response, headersGetter) {
      var ctype = headersGetter('content-type');
      if(ctype && ctype.indexOf('json') > -1) {
        var reg = /:\s?(Infinity|-Infinity|NaN)\s?\,/g;
        return response.replace(reg, ": \"$1\", ");
      } else {
        return response;
      }
    });
  }])
;

/**
 * Top-level module definition for redhawk.directives.  Encapsulates all directives,
 * views, and view controllers as well some filters (here, below).
 */
angular.module('redhawk.directives', ['redhawk.sockets', 'ngRoute'])
  /*
   * Splits the given ID by the "::" syntax that is common and yields the last
   * name of the resulting list.
   */
  .filter('cleanPropId', function() {
    return function (id) {
      var fields = id.split('::');
      return fields[fields.length-1];
    };
  })
;
angular.module('redhawk.rest', ['ngResource'])
  /*
   * Top-level REST factory encapsulating the basic behaviors such as _update and
   * the processing of _runAllUpdatesFinished.  Externally, it provides the updateFinished
   * list of callbacks which are executed in reverse order (highest index first).  If any
   * callback returns `false`, it is removed from the list, making one-shots available
   * even to extended factories.
   */
  .factory('RESTFactory', 
    function() {
      var RESTFactory = function() {
        var self = this;

        /* 
         * List of callback methods that will be executed last to first
         * Methods should return true to remain in the list.
         * Methods that return false will be removed from the list.
         */
        self.updateFinished = [];


        ///////// Internal /////////


        /*
         * Runs through the updateFinished methods.  Any that return false are removed from the list.
         * TODO: Incorporate this behavior into a base class for all factories.
         */
        var _runAllUpdatesFinished = function() {
          var f = self.updateFinished.length;
          while (f--) {
            if (!self.updateFinished[f]())
              self.updateFinished.splice(f, 1);
          }
        }

        self._update = function(updateData) {
          if (!!updateData) {
              angular.extend(self, updateData);
              _runAllUpdatesFinished();
          }
        }
      }

      /* 
       * INTERNAL to the implementation factory.
       * Map of arguments used in in the implementation factory's REST callbacks
       */
      RESTFactory.prototype._restArgs = {};

      return RESTFactory;
    })

  /*
   * Top-level REST factory child that has a 'ports' list in its REST model
   */
  .factory('RESTPortBearer', ['RESTFactory', 'Config', 'InterpolateUrl',
    function(RESTFactory, Config, InterpolateUrl) {
      var RESTPortBearer = function () {
        var self = this;
        RESTFactory.apply(self, arguments);

        // Add the _processPorts method to the list of updateFinished methods.
        self.updateFinished.push(function() { _processPorts.call(self); });


        ///////// INTERNAL //////////

        /**
         * Tags ports with extra fields indicating if each is
         * a BULKIO Output or Frontend Interface Provides port.
         */
        var _processPorts = function() {
          var self = this;

          // Prep the base url and args for interpolation.
          var socketUrl = Config.websocketUrl + self._portConfigUrl;
          var configArgs = angular.extend({}, self._restArgs, { portId: '' });

          var bulkioCheck = function(port) {
            var portDataTypeRegex = /^data(.*)$/;
            var matches = portDataTypeRegex.exec(port.idl.type);
            if(matches) {
              port.canPlot = port.direction == "Uses" && port.idl.namespace == "BULKIO";
              if(port.canPlot) {
                port.plotType = matches[1].toLowerCase();
                configArgs.portId = port.name;
                port.bulkioUrl = InterpolateUrl(socketUrl, configArgs) + '/bulkio';
              }
            } else {
              port.canPlot = false;
            }
          }

          var feiCheck = function (port) {
            if ("FRONTEND" == port.idl.namespace && "Provides" == port.direction) {
              port.canFeiQuery = true;
              port.canFeiTune = ("AnalogTuner" == port.idl.type || "DigitalTuner" == port.idl.type);
            }
            else {
              port.canFeiQuery = false;
              port.canFeiTune = false;
            }
          }

          // Process each.
          angular.forEach(self.ports, function(port) {
            bulkioCheck(port);
            feiCheck(port);
          });

          return false; // Run once.
        }
      }

      // Implement the parent factory.
      RESTPortBearer.prototype = Object.create(RESTFactory.prototype);
      RESTPortBearer.prototype.constructor = RESTPortBearer;

      // Base Config.??PortUrl used for the ports on the implemented factory
      // INTERNAL to the implementation.
      RESTPortBearer.prototype._portConfigUrl = '';

      return RESTPortBearer;
    }])
 ;
angular.module('redhawk.sockets', ['redhawk.rest']);
// Top-level module definition for redhawk.util.  Encapsulates all utilities
angular.module('redhawk.util', ['toastr'])
  .config(function(toastrConfig) {
    angular.extend(toastrConfig, {
      positionClass: 'toast-bottom-right'
    });
  })
;
/*
  Extendable Angular-REDHAWK factory represents a single Component instance.

  An instance, or its extension, can be retrieved from a REDHAWK Domain instance
  using the getComponent(id, appID, <extension name>) method.
 */
angular.module('redhawk')
  .factory('Component', ['$timeout', 'Config', 'REST', 'RESTPortBearer', 'Config',
    function ($timeout, Config, REST, RESTPortBearer, Config) {
      var Component = function(id, domainId, applicationId) {
        var self = this;

        // Inherited Setup
        RESTPortBearer.apply(self, arguments);
        self._portConfigUrl = Config.componentPortUrl;


        ///////// PUBLIC Interfaces (immutable) ///////////
        self.configure = configure;
        self.refresh = refresh;


        ///////// Definitions ////////////

        /**
         * Configure the list of properties (id-value pairs).
         */
        function configure (properties) {
          return REST.component.configure(self._restArgs, { properties: properties },
              function(){ $timeout(_reload, 1000); }
          );
        };

        /*
         * Refresh the REST model
         */
        function refresh() { _reload(); }


        ///////// Internal /////////////


        /**
         * @see {Domain._load()}
         */
        var _load = function(id, domainId, applicationId) {
          self._restArgs = {componentId: id, applicationId: applicationId, domainId: domainId };
          self.$promise = REST.component.query(self._restArgs,
            function(data){
              self.id = id;
              self.waveformId = applicationId;
              self.domainId = domainId;
              self._update(data);
            }).$promise;
        };

        /**
         * @see {Domain._reload()}
         */
        var _reload = function() { _load(self.id, self.domainId, self.waveformId); };

        _load(id, domainId, applicationId);
      };

      Component.prototype = Object.create(RESTPortBearer.prototype);
      Component.prototype.constructor = Component;
      return Component;
  }])  
  

;
/*
  Extendable Angular-REDHAWK factory represents a single Device instance.

  An instance, or its extension, can be retrieved from a REDHAWK Domain instance
  using the getDevice(id, deviceManagerID, <extension name>) method.
 */
angular.module('redhawk')
  .factory('Device', ['$timeout', 'REST', 'RESTPortBearer', 'Config',
    function ($timeout, REST, RESTPortBearer, Config) {
      var Device = function(id, domainId, managerId) {
        var self = this;

        // Inherited setup
        RESTPortBearer.apply(self, arguments);
        self._portConfigUrl = Config.devicePortUrl;

        ///////// PUBLIC Interfaces /////////


        // lastSaveResponse corresponds to the server's last returned
        // message when using configure, allocate, or deallocate.
        self.lastSaveResponse = undefined;

        // Methods
        self.configure = configure;
        self.allocate = allocate;
        self.deallocate = deallocate;
        self.refresh = refresh;


        //////// Definitions //////////

        /*
         * Analogous to their names, pass an array of properties (id-value maps)
         * accordingly to set and un-set properties.
         */
        function configure (properties)  { return _commonSave('configure',  properties); }
        function allocate (properties)   { return _commonSave('allocate',   properties); }
        function deallocate (properties) { return _commonSave('deallocate', properties); }

        /*
         * Refresh the REST model
         */
        function refresh () { _reload; }

        //////// Internal //////////
        /**
         * @see {Domain._load()}
         */
        var _load = function(id, domainId, managerId) {          
          self._restArgs = { deviceId: id, managerId: managerId, domainId: domainId };
          self.$promise = REST.device.query(self._restArgs, 
            function(data){
              self.id = id;
              self.deviceManagerId = managerId;
              self.domainId = domainId;
              self._update(data);
            }
          ).$promise;
        };

        /**
         * @see {Domain._reload()}
         */
        var _reload = function() { _load( self.id, self.domainId, self.deviceManagerId ); };

        /**
         * Save Property State method: Configure, Allocate, Deallocate
         * The lastSaveResponse can be used to see the server response (success, fail, etc.)
         */
        var _commonSave = function(method, properties) {
          return REST.device.save(self._restArgs, { method: method, properties: properties },
            function(response){ 
              $timeout(_reload, 1000);
              self.lastSaveResponse = response;
            }
          );
        };

        _load(id, domainId, managerId);
      }

      Device.prototype = Object.create(RESTPortBearer.prototype);
      Device.prototype.constructor = Device;

      return Device;
  }])
;
/*
  Extendable Angular-REDHAWK factory represents a single DeviceManager instance.

  An instance, or its extension, can be retrieved from a REDHAWK Domain instance
  using the getDeviceManager(id, <extension name>) method.
 */
angular.module('redhawk')
  .factory('DeviceManager', ['REST', 'RESTFactory',
    function (REST, RESTFactory) {
      var DeviceManager = function(id, domainId) {
        var self = this;

        // Inherited Setup
        RESTFactory.apply(self, arguments);

        //////// PUBLIC Interfaces (immutable) ///////////
        self.refresh = refresh;

        //////// Definitions /////////
        

        function refresh () { _reload(); }


        //////// Internal /////////
        

        /**
         * @see {Domain._load()}
         */
        var _load = function(id, domainId) {
          self._restArgs = { managerId: id, domainId: domainId };
          self.$promise = REST.deviceManager.query(self._restArgs, 
            function(data) {
              self.id = id;
              self.domainId = domainId;
              self._update(data);
            }).$promise;
        }

        /**
         * @see {Domain._reload()}
         */
        var _reload = function() { _load(self.id, self.domainId); }

        _load(id, domainId);
      };

      DeviceManager.prototype = Object.create(RESTFactory.prototype);
      DeviceManager.prototype.constructor = DeviceManager;
      return DeviceManager;
  }])

;
/*
 * A collection of directives related to viewing events from an event channel.
 */
angular.module('redhawk.directives')
  /*
   * Provides a list-view of messages and/or event structures in the order
   * found in events
   * 
   * @param events - Array of event/message structures
   * @param max - The maximum number of elements to show (>= 1)
   */
  .directive('eventView', function () {
    return {
      templateUrl: 'directives/tmpls/events/event-view.html',
      restrict: 'E',
      scope: {
        rhEvents   : '=',
        max        : '='
      },
      controller: function($scope) {
        // setup defaults.
        $scope.max = $scope.max || 5;

        /*
         * Determines the type of the event structure:
         *    0 = Unknown
         *    1 = ODM
         *    2 = IDM
         *    3 = Prop Event
         *    4 = Message
         */
        $scope.typeOfEvent = function (rhEvent) {
          var t = 0;

          if (rhEvent.hasOwnProperty('sourceCategory') && rhEvent.sourceName) {
            t = 1;
          }
          else if (rhEvent.hasOwnProperty('stateChangeCategory') && rhEvent.stateChangeCategory) {
            t = 2;
          }
          else if (rhEvent.hasOwnProperty('properties') && rhEvent.properties) {
            t = 3;
          }
          if (rhEvent.hasOwnProperty('id') && rhEvent.id) {
            t = 4;
          }
          return t;
        };
      }
    }
  })
  
  .directive('odmEvent', function () {
    return {
      templateUrl : 'directives/tmpls/events/odm-event.html',
      restrict    : 'E',
      scope       : { obj : '=rhEvent' }
    }
  })
  .directive('idmEvent', function () {
    return {
      templateUrl : 'directives/tmpls/events/idm-event.html',
      restrict    : 'E',
      scope       : { obj : '=rhEvent' }
    }
  })
  .directive('propEvent', function () {
    return {
      templateUrl : 'directives/tmpls/events/prop-event.html',
      restrict    : 'E',
      scope       : { obj : '=rhEvent' }
    }
  })
  .directive('messageEvent', function () {
    return {
      templateUrl : 'directives/tmpls/events/message-event.html',
      restrict    : 'E',
      scope       : { obj : '=rhEvent' }
    }
  })
;

angular.module('redhawk.directives')

  /**
   * Similar to admin-console's version, the controller manages updating
   * settings as the SRI and buffers change.  What's different?
   *  
   * This controller assumes the directive $scope was given a BULKIO port
   * which it can intuit using the bulkioUrl and plotType fields that are 
   * provided by RESTPortBearer base factory.
   *
   * The result is a controller that internally manages a socket connected
   * to the bulkio port.  If the DOM element and controller are removed
   * (destroyed) the socket closes automatically.
   */
  .controller('BulkioSocketController', 
    ['$scope', 'Subscription', 'BulkioPB2', 'SigPlotFillStyles',
    function ($scope, Subscription, BulkioPB2, SigPlotFillStyles) {
      // Get a new socket instance and listen for binary and JSON data.
      var portSocket = new Subscription();
      portSocket.addBinaryListener(on_data);
      var plotValid = false;

      /*
       * When the plot settings change, create a new sigplot
       */
      $scope.$watch('plotSettings', function(plotSettings) {
        plotValid = false;
        $scope.plotSettings = plotSettings;
        $scope.plot = new sigplot.Plot(
          $scope.element,
          $scope.plotSettings
        );
        $scope.plot.change_settings({
          fillStyle: $scope.fillStyle
        });
        $scope.signalLayers = {};
        plotValid = true;
      }, true);

      /* 
       * When the URL changes, attempt to connect to the socket.
       */
      $scope.$watch('port', function(port) {
        plotValid = false;
        portSocket.close();
        if (port && port.bulkioUrl && port.canPlot) {
          $scope.plot.deoverlay();
          $scope.signalLayers = {};
          portSocket.connect(port.bulkioUrl, function() { 
            console.log("Connected to BULKIO port @ " + port.bulkioUrl);
            plotValid = true;
          });
        }
      });

      /*
       * If the controller closes/is removed, be nice and shut down the socket
       */
      $scope.$on("$destroy", function() {
        portSocket.close();
      });

      /*
       * Process the incoming raw data into its structure and then plots it.
       * TODO: Add multi-layer support.  by having multiple plot layers and 
       *       refreshing them independently, one can have multiple signals 
       *       on the same plot.
       */
      function on_data (raw) {
        if (!plotValid) {
          return;
        }

        var dataPB2 = BulkioPB2.get(raw);

        // On EOS remove the layer
        if (dataPB2.EOS && $scope.signalLayers.hasOwnProperty(dataPB2.streamID)) {
          var plotLayer = $scope.signalLayers[dataPB2.streamID].plotLayer;
          $scope.plot.remove_layer(plotLayer);
          delete $scope.signalLayers[dataPB2.streamID];
          return;
        }

        var reloadSettings = false;

        // Format string specific to sigplot
        // per the enclosed data type
        var getFormatStr = function(bulkioObj) {
          var s = (bulkioObj.SRI.mode === BulkioPB2.sriModes.COMPLEX) ? 'C' : 'S';
          switch (bulkioObj.type) {
            case BulkioPB2.dataTypes.Float:
              s += 'F';
              break;
            case BulkioPB2.dataTypes.Double:
              s += 'D';
              break;
            case BulkioPB2.dataTypes.Short:
            case BulkioPB2.dataTypes.Char:
            case BulkioPB2.dataTypes.Octet:
            default: // TODO: Account for the various Long's
              s += 'B';
              break;
          }
          return s;
        }

        // Get or create a copy of data settings for this streamID
        var signalLayerData = null;
        if (dataPB2.streamID in $scope.signalLayers) {
          signalLayerData = $scope.signalLayers[dataPB2.streamID];
        }
        if (!signalLayerData) {
          reloadSettings = true;
          var dataSettings = angular.copy($scope.dataSettings);
          var plotLayer = $scope.plot.overlay_array(
            dataPB2.streamID, 
            null
          );
          var signalLayerData = {
            'dataSettings' : dataSettings,
            'plotLayer'    : plotLayer
          };
          $scope.signalLayers[dataPB2.streamID] = signalLayerData;

          // Override fillStyle if it contains fills and we are plotting
          // now more than one signal
          var numKeys = Object.keys($scope.signalLayers).length;

          if (1 < numKeys) {
            $scope.originalFillStyle = angular.copy($scope.fillStyle);
            $scope.fillStyle = SigPlotFillStyles.DefaultLine;
            $scope.plot.change_settings({
              fillStyle: $scope.fillStyle,
            });
          } else if (1 == numKeys) {
            $scope.fillStyle = $scope.originalFillStyle;
            $scope.plot.change_settings({
              fillStyle: $scope.fillStyle
            });
          }
        }
        
        if (!!dataPB2.sriChanged) {
          reloadSettings = true;
          signalLayerData.dataSettings.xstart  = dataPB2.SRI.xstart;
          signalLayerData.dataSettings.xdelta  = dataPB2.SRI.xdelta;
          signalLayerData.dataSettings.size    = dataPB2.SRI.subsize;
          signalLayerData.dataSettings.subsize = dataPB2.SRI.subsize;
          signalLayerData.dataSettings.format  = getFormatStr(dataPB2);
        }

        if (!!dataPB2.dataBuffer) {
          if (reloadSettings) {
            $scope.plot.reload(
              signalLayerData.plotLayer, 
              dataPB2.dataBuffer, 
              signalLayerData.dataSettings);
            $scope.plot.refresh();
          }
          else {
            $scope.plot.reload(
              signalLayerData.plotLayer, 
              dataPB2.dataBuffer);
          }

          // A hack noted that this field gets ignored repeatedly.
          // this fixes it.
          $scope.plot._Gx.ylab = signalLayerData.dataSettings.yunits;
        }
      }

      /* Detect width of the plotting container having changed.
       * If it changes, calculate the Log2 equivalent width and 
       * pass it back to the server.  The result will do decimate
       * using a neighbor-mean approach.
      */
      var currentPow = 0;
      $scope.maxSamples = $scope.maxSamples || 1024;
      $scope.$watch('maxSamples',
        function() {
          var newPow = Math.floor(Math.log($scope.maxSamples) / Math.log(2));
          if (currentPow != newPow) {
            currentPow = newPow;
            var widthLog2 = Math.pow(2, newPow);

            var controlPB2 = BulkioPB2.controlWidth(widthLog2);
            portSocket.send(controlPB2.toBuffer());
          }
        }
      );
    }])
  
  /*
   * Various fill styles for the sigPlotPsd.
   */
  .constant('SigPlotFillStyles', {
    'DefaultLine' : null, // Default line is no fill, because it's a line.
    'DefaultPSD'  : [
      // Color cascade through the spectrum
      "rgba(255, 255, 100, 0.7)",
      "rgba(255, 0, 0, 0.7)",
      "rgba(0, 255, 0, 0.7)",
      "rgba(0, 0, 255, 0.7)"
    ]
  })

  /**
   * This is a PSD plot PSD directive.  Provide the BULKIO port and
   * an explicit height (i.e., not a percent).
   *
   * This can be obtained by finding a port with `canPlot == true` 
   * and supplying it to the directive:
   * <sig-plot-psd port="device.port" height="400"></sig-plot-psd>
   */
  .directive('sigPlotPsd', ['SigPlotFillStyles',
    function(SigPlotFillStyles) { 
      return { 
        restrict: 'E',
        template: '<div style="height: inherit; width: inherit;"></div>',
        scope: {
          port:         '=', // A BULKIO Port
          overrideID:   '@', // Override the DOM element ID the plot will use.
          plotSettings: '=', // Plot Settings
          fillStyle:    '@', // Filling settings
          maxSamples:   '@', // Controls decimation factor.
        },
        controller: 'BulkioSocketController',
        link: function(scope, element, attrs) {
          function randomID() {
              var text = "";
              var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

              for( var i=0; i < 5; i++ )
                  text += possible.charAt(Math.floor(Math.random() * possible.length));

              return 'sigPlot_' + text;
          }
          // Set the directive ID to overrideID or make something up.
          var sigPlotID = scope.overrideID || randomID();

          // See http://demo.axiosengineering.com/sigplot/doc/global.html#UNITS
          // regarding the `units` enumerations
          scope.dataSettings = {
            xdelta  :     1,
            xunits  :     3,  // Frequency (Hz)
            xstart  :     0,
            yunits  :    27,  // Magnitude, 20-log
            ystart  :     0,
            subsize :  2048,
            size    :  2048,
            format  :  'SF',  
          };

          // Derived from admin-console
          // NOTE: These settings are similar to xmidas, on which sigplot is based.
          scope.plotSettings = scope.plotSettings || {
            all               : true,
            expand            : true,
            autox             : 3,
            autoy             : 3,
            ydiv              : 10,
            xdiv              : 10,
            nopan             : true,
            xcnt              : 0,
            colors            : {bg: "#222", fg: "#888"},
            cmode             : "MA"
          }

          // Save a reference to the DOM element in case the sigplot is reset
          scope.element = element.children()[0];

          // Plot handle and fill settings.
          scope.plot = new sigplot.Plot(
            scope.element,
            scope.plotSettings);

          // Fill settings are CSS settings
          scope.fillStyle = scope.fillStyle || SigPlotFillStyles.DefaultPSD;
          scope.plot.change_settings({
            fillStyle: scope.fillStyle,
          });
          scope.originalFillStyle = scope.fillStyle;

          // The plot layer is what gets updated when the buffer is drawn.
          // Adding multiple layers will create a legend such that the file_name
          // is the signal name.
          scope.signalLayers = {};
        }
      }; 
    }]);


/*
  * The status enum attribute can be applied to buttons or labels.
  * to simplify putting color-coded enumerations (and text) onto your UI
  * in with a reusable directive.  
  * 
  * @param status - string "value" to select from the enumeration
  * @param enumeration - Map of string-values to Bootstrap CSS class and display
  *                 text.  The cssClass will either result in btn-<name> or 
  *                 label-<name> depending on the other classes in the DOM element.
  *                 An example enumeration map is:
  *           { 
  *             '-1' : { cssClass: 'danger',  text: 'Red' },
  *             '0'  : { cssClass: 'warning', text: 'Yellow-ish orange' },
  *             '1'  : { cssClass: 'success', text: 'Green' },
  *             '2'  : { cssClass: 'info',    text: 'Blue' },
  *           }
  *
  * Usage: <label status-enum class="label-sm" status="mystatus" enumeration="statusenum"></label>
  *
  * The resulting label will track mystatus and appropriately change the element class and insert
  * text to match.
  */
angular.module('redhawk.directives')
  .directive('statusEnum', function () {
    return {
        restrict: 'A',
        scope: { 
          status: "=",
          enumeration: "="
        },
        replace: false,
        link: function(scope, elem, attrs) {
          scope.$watch('status', function(status) {
            scope.nextClass = (elem.hasClass('btn')) ? 'btn-' : 'label-';
            scope.nextClass += scope.enumeration[status].cssClass;

            if (scope.lastClass)
              elem.removeClass(scope.lastClass);
            elem.addClass(scope.nextClass);
            scope.lastClass = scope.nextClass;

            elem.html(scope.enumeration[status].text);
          });
        }
      };
  })
;

/* 
  Extendable Angular-REDHAWK factory represents a single Domain instance.

  Use the REDHAWK service getDomain(id) method to get an instance of this
  factory, or extend this factory, and retrieve it also using the REDHAWK
  service: 
    getDomain(id, extensionName);
 */
angular.module('redhawk')
  .factory('Domain', ['$injector', 'EventChannel', 'NotificationService', 'REST', 'RESTFactory', 'DeviceManager', 'Device', 'Waveform', 'Component',
    function($injector, EventChannel, NotificationService, REST, RESTFactory, DeviceManager, Device, Waveform, Component) {
      var Domain = function(id) {
        var self = this;

        // Inherited Setup
        RESTFactory.apply(self, arguments);

        ///////// PUBLIC (immutable) //////////
        self.refresh = refresh;
        self.configure = configure;
        self.getFileSystem = getFileSystem;
        // Getting Device Managers and Devices
        self.getDeviceManager = getDeviceManager;
        self.getDevice = getDevice;
        // Launching and getting Waveforms, Components.
        self.getLaunchableWaveforms = getLaunchableWaveforms;
        self.launch = launch;
        self.getWaveform = getWaveform;
        self.getComponent = getComponent;

        // Event Channel access
        self.events = []; // buffer
        self.addEventChannel = addEventChannel;
        self.removeEventChannel = removeEventChannel;
        self.getChannelNames = getChannelNames;

        //////// PUBLIC (mutable) /////////
        // on_msg -- Replace with a function to call when event channel messages are received
        // on_connect -- Replace with a function to call when the event channel connects



        ///////// Definitions ////////

        /**
         * Refresh the REST model
         */
        function refresh() { _reload(); }

        /**
         * Configure REDHAWK properties for this object.
         * @param properties
         */
        function configure (properties) {
          REST.domain.configure(self._restArgs, { properties: properties });
        };

        /**
         * Gets filesystem information at path.
         * @deprecated - Not implemented in current versions of the backend
         * @param path
         * @returns {*}
         */
        function getFileSystem (path) {
          return REST.fileSystem.query( angular.extend({}, self._restArgs, { path: path }) );
        };

        /**
         * Get a device manager object from this domain.
         * @param id
         * @param factoryName
         * @returns {*}
         */
        function getDeviceManager (id, factoryName) {
          var storeId = id + ((factoryName) ? factoryName : 'DeviceManager');
          if(!self.deviceManagers[storeId]) {
            var constructor = (factoryName) ? $injector.get(factoryName) : DeviceManager;
            self.deviceManagers[storeId] = new constructor(id, self.name);
          }
          return self.deviceManagers[storeId];
        };

        /**
         * Get a device object from this domain.
         * @param id
         * @param deviceManagerId
         * @param factoryName
         * @returns {*}
         */
        function getDevice (id, deviceManagerId, factoryName) {
          var storeId = id + ((factoryName) ? factoryName : 'Device');
          if(!self.devices[storeId]){
            var constructor = (factoryName) ? $injector.get(factoryName) : Device;
            self.devices[storeId] = new constructor(id, self.name, deviceManagerId);
          }

          return self.devices[storeId];
        };

        /**
         * Get a list of Waveforms available for launching.
         * @returns {Array}
         */
        function getLaunchableWaveforms () {
          if(!self.availableWaveforms) {
            self.availableWaveforms = [];
            self.availableWaveforms.$promise =
              REST.waveform.status(self._restArgs).$promise
                .then(function(data){
                  angular.forEach(data.waveforms, function(item){
                    this.push(item.name);
                  }, self.availableWaveforms);

                  return self.availableWaveforms;
                });
          }

          return self.availableWaveforms;
        };

        /**
         * Launch a Waveform.
         * @param name
         * @returns {*}
         */
        function launch (name) {
          return REST.waveform.launch(self._restArgs, { name: name },
            function(data){
              notify.success("Waveform "+data['launched']+" launched");
              _reload();
            },
            function(){
              notify.error("Waveform "+name+" failed to launch.");
            }
          );
        };

        /**
         * Get a waveform object from this domain.
         * @param id
         * @param factoryName
         * @returns {*}
         */
        function getWaveform (id, factoryName){
          var storeId = id + ((factoryName) ? factoryName : 'Waveform');
          if(!self.waveforms[storeId]) {
            var constructor = (factoryName) ? $injector.get(factoryName) : Waveform;
            self.waveforms[storeId] = new constructor(id, self.name);
          }

          return self.waveforms[storeId];
        };
        
        /**
         * Get a component object from this domain.
         * @param id
         * @param applicationId
         * @param factoryName
         * @returns {*}
         */
        function getComponent (id, applicationId, factoryName) {
          var storeId = id + ((factoryName) ? factoryName : 'Component');
          if(!self.components[storeId]) {
            var constructor = (factoryName) ? $injector.get(factoryName) : Component;
            self.components[storeId] = new constructor(id, self.name, applicationId);
          }

          return self.components[storeId];
        };

        /**
         * Add the named event channel to the list of subscriptions.
         */
        function addEventChannel (name) {
          if (!!eventChannel)
            eventChannel.addChannel(name);
        }

        /**
         * Remove the named event channel from the list of subscriptions.
         */
        function removeEventChannel (name) {
          if (!!eventChannel)
            eventChannel.removeChannel(name);
        }

        /**
         * Get a list of active channel names on the eventChannel socket
         */
        function getChannelNames () {
          if (!!eventChannel)
            return eventChannel.getChannelNames();
          else
            return [];
        }


        ///////// Internal //////////

        // For pushing notifications to the UI when a waveform is launched.
        var notify = NotificationService;

        // Event Channel Socket
        var eventChannel = null;

        /**
         * Handles loading data from the REST interface.
         * @param id
         * @private
         */
        var _load = function(id) {
          self._restArgs = { domainId: id };
          self.name = id;

          // Event socket.
          if (!eventChannel)
            eventChannel = new EventChannel(id, self.events, _on_msg, _on_connect);

          // Local storage maps of spawned factories.
          self.deviceManagers = {};
          self.waveforms = {};
          self.components = {};
          self.devices = {};

          self.$promise = REST.domain.info(self._restArgs,
            function(data) {
              self._update(data);
            }).$promise;
        };

        /**
         * Reloads the data based on existing identifiers.
         * @private
         */
        var _reload = function() { _load(self.name); };

        /**
         * Internal calback for event channel on_msg
         */
        var _on_msg = function (msg) {
          // TODO: Process the message to update the model and spawned factories
          // Forward the message to the spawned factory (if it exists)?
          // Automatically spawn and tear-down factories?
          
          // Finally, call the overloaded on_msg (below)
          if (self.on_msg)
            self.on_msg(msg);
        }

        /**
         * Internal callback for event channel on_connect
         */
        var _on_connect = function () {
          eventChannel.addChannel('IDM_Channel');
          eventChannel.addChannel('ODM_Channel');
          // TODO: Add automatic sweep through REST model for device managers and 
          // applications of interest (if they're online) and spawn those factories.
          // similar to how the examples do it.
          if (self.on_connect)
            self.on_connect();
        }

        _load(id);
      };

      Domain.prototype = Object.create(RESTFactory.prototype);
      Domain.prototype.constructor = Domain;

      // EXTERNAL : EventChannel callbacks
      // Set these to your callbacks to be notified in each case.
      Domain.prototype.on_connect = undefined;
      Domain.prototype.on_msg = undefined;

      return Domain;
  }])
;

/**
 * Angular-REDHAWK Device extension that is known to have an FEI Provides interface port.
 *
 * In other words, if you know the Device has an FEI port, use the Domain's method 
 * getDevice(id, deviceManagerID, 'FEIDevice') to gain the extra feiQuery method
 * for accessing those specialized structures.
 * 
 * If the device is known to provide an FEI Tuner interface, use the FEITunerDevice
 * instead; it provides more appropriate methods for managing tuners.
 */
angular.module('redhawk')
  .factory('FEIDevice', ['Device', 'REST',
    function(Device, REST) {
      var FEIDevice = function() {
        var self = this;
        Device.apply(self, arguments);

        //////// PUBLIC Interfaces ////////
        self.feiQuery = feiQuery;



        //////// Definitions /////////
        // Returns a promise
        function feiQuery (portId) {
          return REST.feiDevice.query(
            angular.extend({}, self._restArgs, { portId: portId }),
            function(data) { 
              angular.forEach(self.ports, function(port) {
                if (port.name == data.name)
                  angular.extend(port, data);
              }); 
            }
          ).$promise;
        };
      }

      FEIDevice.prototype = Object.create(Device.prototype);
      FEIDevice.prototype.constructor = FEIDevice;

      return FEIDevice;
    }])
;
/**
 * Angular-REDHAWK Device extension specifically useful for Devices that are known to 
 * have an FEI *Tuner Provides interface.
 */
angular.module('redhawk')
  .factory('FEITunerDevice', ['Device', 'REST', 
    function(Device, REST) {
      var FEITunerDevice = function() {
        var self = this;
        Device.apply(self, arguments);

        ///////// Additional public interfaces (immutable) //////////
        self.feiQuery = feiQuery;
        self.feiTune = feiTune;
        self.getTunerAllocationProps = getTunerAllocationProps;
        self.getListenerAllocationProps = getListenerAllocationProps;



        //////// Definitions ///////////


        /* 
         * Gets a copy of the REDHAWK Property ID for tuner_allocation
         */
        function getTunerAllocationProps  () {
          var p = UtilityFunctions.findPropId(self.properties, 'FRONTEND::tuner_allocation');
          return angular.copy(p);
        }

        /* 
         * Gets a copy of the REDHAWK Property ID for listener_allocation
         */
        function getListenerAllocationProps  () {
          var p = UtilityFunctions.findPropId(self.properties, 'FRONTEND::listener_allocation');
          return angular.copy(p);
        }

        // Returns a promise, allocatioNId is optional.
        function feiQuery (portId, allocationId) {
          return REST.feiTunerDevice.query(
            angular.extend({}, self._restArgs, {allocationId: allocationId, portId: portId}),
            function(data) {
              angular.forEach(self.ports, function(port) {
                if (port.name == data.name) {
                  if (port.active_allocation_ids) {
                    // data is the FEITuner structure w/ an updated allocation ID list and no id-keys filled.
                    // Find the port and remove any invalid allocation ids, then extend to update valid ones.
                    var oldIDs = UtilityFunctions.filterOldList(port.active_allocation_ids, data.active_allocation_ids);
                    for (var i=0; i < oldIDs.length; i++) {
                      delete port[oldIDs[i]];
                    }
                  }
                  angular.extend(port, data);
                }
              }); 
            }
          ).$promise;
        };

        // Returns a promise
        function feiTune (portId, allocationId, properties) {
          return REST.feiTunerDevice.tune(
              angular.extend({}, self._restArgs, { allocationId: allocationId, portId: portId }),
              {properties: properties},
              function () { return self.feiQuery(portId, allocationId); }
          );
        };
      }

      FEITunerDevice.prototype = Object.create(Device.prototype);
      FEITunerDevice.prototype.constructor = FEITunerDevice;

      return FEITunerDevice;
    }])
;

/* 
  Extendable Angular-REDHAWK factory represents the REDHAWK infrastructure.

  The REDHAWK Service represents the underlying subsystems that support
  REDHAWK.  It can be used to discover and launch new domains as well as
  attach to event channels (IDM, ODM, named Message channels, etc.).

  Use enablePush() to connect to the domain watching websocket, and then
  (optionally) use addListener(callback) to receive notifications when
  domain-related messages are received.
 */
angular.module('redhawk')
  .service('REDHAWK', ['$injector', 'REST', 'Config', 'Subscription',
    function($injector, REST, Config, Subscription) {
      var redhawk = this;

      // PUBLIC Interfaces
      redhawk.domainIds = [];
      redhawk.getDomainIds = getDomainIds;
      redhawk.getDomain = getDomain;

      // For pushed updates
      redhawk.enablePush = enablePush;
      redhawk.disablePush = disablePush;
      redhawk.addListener = addListener;
      redhawk.removeListener = removeListener;


      ////////// DEFINITIONS BELOW ////////////

      /**
       *  Returns a list of REDHAWK Domains available.
       *
       * @returns {Array.<string>}
       */
      function getDomainIds () {
        if(!redhawk.domainIds) {
          redhawk.domainIds.$promise = REST.domain.query()
            .$promise
            .then(
              function(data){
                angular.forEach(data.domains, function(id) {
                  this.push(id);
                }, redhawk.domainIds);
                return redhawk.domainIds;
              }
            );
        }
        return redhawk.domainIds;
      };

      /**
       * Returns a resource with a promise to a {Domain} object.
       *
       * @param id - String ID of the domain
       * @param factoryName - String name to inject as the constructor rather than RedhawkDomain
       * @returns {Domain}
       */
      function getDomain (id, factoryName) {
        var storeId = id + ((factoryName) ? factoryName : 'Domain');

        if(!_domains[storeId]) {
          var constructor = (factoryName) ? $injector.get(factoryName) : $injector.get('Domain');
          _domains[storeId] = new constructor(id);
        }

        return _domains[storeId];
      };
      
      /**
       * Add a listener to the system's socket which carries information about Domains 
       * joining and leaving the networked REDHAWK system.
       */
      function addListener (callback) {
        if (!redhawkSocket) 
          redhawk.enablePush(); // Connect first...otherwise what's the point?

        // Forward the callback
        redhawkSocket.addJSONListener(callback);
      }

      /**
       * Remove a listener to the system's socket.
       */
      function removeListener (callback) {
        if (!redhawkSocket) return;
        redhawkSocket.removeJSONListener(callback);
      }

      /**
       * Enable pushed updates (via websocket)
       */
     function enablePush() {
        if (!redhawkSocket) {
          // Connect to the system-wide socket (domains joining and leaving);
          redhawkSocket = new Subscription();

          redhawkSocket.connect(Config.redhawkSocketUrl, 
            function () { 
              on_connect.call(redhawk); 
            });

          redhawkSocket.addJSONListener(
            function (msg) {
              on_msg.call(redhawk, msg);
            });
        }
      }

      /**
       * Disable pushed updates (via websocket);
       */
      function disablePush () {
        if (!!redhawkSocket)
          redhawkSocket.close();
        redhawkSocket = null;
      }


      ///////////////// INTERNAL ///////////////
      var _domains = {};        // A map of Domain factories launched by getDomain
      var redhawkSocket = null; // Handle for the service socket.

      var on_connect = function() {
        console.debug('Connected to REDHAWK Domain Monitoring Socket')
      }

      var on_msg = function(msg) {
        // msg is { domains: [], added: [], removed: [] }
        angular.copy(msg.domains, redhawk.domainIds);
      }

  }])
 ;

/*
  The REDHAWK REST Config provider encapsulates all of the URL transforms
  that represent the rest-python -exposed API (i.e., its URL Handlers).
 */
angular.module('redhawk.rest')
  .provider('Config', [function(){
    var getWSBasePath = function() {
      var loc = window.location, new_uri;
      if (loc.protocol === "https:") {
        new_uri = "wss:";
      } else {
        new_uri = "ws:";
      }
      new_uri += "//" + loc.host;

      return new_uri;
    };

    this.restPath = '/redhawk/rest';
    this.websocketUrl = getWSBasePath();
    this.restUrl = this.restPath;

    this.redhawkSocketUrl = this.websocketUrl + this.restPath + '/redhawk';
    this.eventSocketUrl = this.websocketUrl + this.restPath + '/events';

    // General locations
    this.portsUrl = '/ports';
    this.portUrl = this.portsUrl + '/:portId';

    // Full URL helper paths matching the handlers back at the server.
    this.domainsUrl = this.restUrl + '/domains';
    this.domainUrl = this.domainsUrl + '/:domainId';
    this.deviceManagerUrl = this.domainUrl + '/deviceManagers/:managerId';
    this.deviceUrl = this.deviceManagerUrl + '/devices/:deviceId';
    this.devicePortsUrl = this.deviceUrl + this.portsUrl;
    this.devicePortUrl = this.deviceUrl + this.portUrl;
    this.waveformsUrl = this.domainUrl + '/applications';
    this.waveformUrl = this.waveformsUrl + '/:applicationId';
    this.waveformPortsUrl = this.waveformUrl + this.portsUrl;
    this.waveformPortUrl = this.waveformUrl + this.portUrl;
    this.componentsUrl = this.waveformUrl + '/components';
    this.componentUrl = this.componentsUrl + '/:componentId';
    this.componentPortsUrl = this.componentUrl + this.portsUrl;
    this.componentPortUrl = this.componentUrl + this.portUrl;

    var provider = this;
    this.$get = function() {
      return {
        restPath:         provider.restPath,
        websocketUrl:     provider.websocketUrl,
        redhawkSocketUrl: provider.redhawkSocketUrl,
        eventSocketUrl:   provider.eventSocketUrl,
        restUrl:          provider.restUrl,
        domainsUrl:       provider.domainsUrl,
        domainUrl:        provider.domainUrl,
        deviceManagerUrl: provider.deviceManagerUrl,
        deviceUrl:        provider.deviceUrl,
        devicePortUrl:    provider.devicePortUrl,
        waveformsUrl:     provider.waveformsUrl,
        waveformUrl:      provider.waveformUrl,
        waveformPortUrl:  provider.waveformPortUrl,
        componentUrl:     provider.componentUrl,
        componentPortUrl: provider.componentPortUrl,
      };
    };
  }])
  
  /* 
   * Service for changing a parameterized Config url with 
   * appropriate parameters.  For example //domains/:domainId
   * becomes //domains/REDHAWK_DEV, etc.
   *
   * Adapted from: http://www.bennadel.com/blog/2613-using-url-interpolation-with-http-in-angularjs.htm
   */
  .service('InterpolateUrl', function() {
    return function (configUrl, params) {
      localParams = (angular.extend({}, params) || {});

      configUrl = configUrl.replace( /(\(\s*|\s*\)|\s*\|\s*)/g, "" );

      // Replace each label in the URL (ex, :domainId).
      configUrl = configUrl.replace(
        /:([a-z]\w*)/gi,
        function( $0, label ) {
          return( popFirstKey( localParams, label ) || "" );
        }
      );

      // Strip out any repeating slashes (but NOT the http:// version).
      configUrl = configUrl.replace( /(^|[^:])[\/]{2,}/g, "$1/" );

      // Strip out any trailing slash.
      configUrl = configUrl.replace( /\/+$/i, "" );

      // Take 1...N objects and key and perform popKey on the first object
      // that has the given key. All others with the same key are ignored.
      function popFirstKey( object1, objectN, key ) {
        // Convert the arguments list into a true array so we can easily
        // pluck values from either end.
        var objects = Array.prototype.slice.call( arguments );

        // The key will always be the last item in the argument collection.
        var key = objects.pop();

        var object = null;

        // Iterate over the arguments, looking for the first object that
        // contains a reference to the given key.
        while ( object = objects.shift() ) {
          if ( object.hasOwnProperty( key ) ) {
            return( popKey( object, key ) );
          }
        }
      }
    
      // Delete the key from the given object and return the value.
      function popKey( object, key ) {
        var value = object[ key ];
        delete( object[ key ] );
        return( value );
      }

      return( configUrl );
    };
  })
;

/*
  The REST service provides all of the basic HTTP request functionality
  distilled into methods that are used by the REDHAWK service and its various
  factories (Domain, Device, etc.).
*/
angular.module('redhawk.rest')
  .service('REST', ['$resource', 'Config', 
    function($resource, Config) {
      this.domain = $resource(Config.domainsUrl, {}, {
        query:        {method: 'GET', cache:false},
        info:         {method: 'GET', url: Config.domainUrl, cache:false},
      });

      /* Retaining for future upcoming feature 
      this.fileSystem = $resource(Config.domainUrl + '/fs/:path', {}, {
        query:        {method: 'GET', cache:false}
      }); */

      this.deviceManager = $resource(Config.deviceManagerUrl, {}, {
        query:        {method: 'GET', cache:false}
      });

      this.device = $resource(Config.deviceUrl, {}, {
        query:        {method: 'GET', cache:false},
        save:         {method: 'PUT', url: Config.deviceUrl + '/properties'},
      });

      this.feiDevice = $resource(Config.devicePortUrl, {}, {
        query:        {method: 'GET', cache:false },
      });

      this.feiTunerDevice = $resource(Config.devicePortUrl + '/:allocationId', {}, {
        query:        {method: 'GET', cache:false },
        tune:         {method: 'PUT' }
      });

      this.waveform = $resource(Config.waveformsUrl, {}, {
        query:        {method: 'GET',    url: Config.waveformUrl, cache:false},
        status:       {method: 'GET',    url: Config.waveformsUrl, cache:false},
        launch:       {method: 'POST',   url: Config.waveformsUrl},
        release:      {method: 'DELETE', url: Config.waveformUrl},
        update:       {method: 'POST',   url: Config.waveformUrl},
        configure:    {method: 'PUT',    url: Config.waveformUrl + '/properties'}
      });

      this.component = $resource(Config.componentUrl, {}, {
        query:        {method: 'GET', cache:false},
        configure:    {method: 'PUT', url: Config.componentUrl + '/properties'}
      });
  }])
;

/* 
 * Angular-REDHAWK Event Channel Listener.
 * 
 * Constructor requires domainID; the remaining elements are optional.  If you provide
 * a buffer, the EventChannel will maintain the list up to 500 in length automatically.
 * 
 * Use addChannel and removeChannel to attach to channel names (e.g., 'IDM_Channel').
 * 
 * Requires a Domain ID to filter incoming messages.
 */
angular.module('redhawk.sockets')
  .factory('EventChannel', ['Subscription', 'Config',
    function(Subscription, Config) {
      return function(domainID, buffer, parent_on_msg, parent_on_connect) {
        var self = this;

        // Public interfaces (immutable)
        self.addChannel = addChannel;
        self.removeChannel = removeChannel;
        self.getMessages = getMessages;
        self.getChannelNames = getChannelNames;
        self.addListener = addListener;
        self.removeListener = removeListener;

        ///// DEFINITIONS BELOW ///////

        /*
         * Connect to a named channel.
         * For example, addChannel('ODM_Channel')
         */
        function addChannel (channel) {
          if (-1 == channels.indexOf(channel)) {
            eventMessageSocket.send(Msg('ADD', channel));
            channels.push(channel);
            console.debug('Connected to ' + domainID + '-->' + channel);
          }
        }

        /*
         * Disconnect from a named channel.
         * For example, addChannel('ODM_Channel')
         */
        function removeChannel (channel) {
          var chanIdx = channels.indexOf(channel)
          if (-1 < chanIdx) {
            eventMessageSocket.send(Msg('REMOVE', channel));
            channels.splice(chanIdx, 1);
            console.debug('Disconnected from ' + domainID + '-->' + channel);
          }
        }

        /* 
         * Retrieve a copy of the message buffer
         */
        function getMessages () {
          return angular.copy(messages);
        }

        /* 
         * Retrieve a copy of the event channels known to this instance.
         */
        function getChannelNames () {
          return angular.copy(channels);
        }

        /*
         * Add an additional listener callback to this EventChannel's various subscriptions.
         */
        function addListener (callback) {
          eventMessageSocket.addJSONListener(callback);
        }

        /*
         * Stop listening to this EventChannels' subscriptions.
         */
        function removeListener (callback) {
          eventMessageSocket.removeListener(callback);
        }

        ///////////// INTERNAL ////////////

        // Use the provided buffer or a new list
        var messages = buffer || [];
        var channels = [];

        var on_connect = function() {
          if (parent_on_connect)
            parent_on_connect.call(self);
        }

        var on_msg = function(obj){
          messages.push(obj);

          if(messages.length > 500)
            angular.copy(messages.slice(-500), messages);

          if (parent_on_msg)
            parent_on_msg.call(self, obj);
        }

        var Msg = function(command, topic, domainId) {
          return JSON.stringify({command: command, topic: topic, domainId: domainID});
        }

        // Create the subscription socket, connect to the appropriate URL, and wait for connection.
        // Bind a JSON listener to forward incoming events to the local handler.
        var eventMessageSocket = new Subscription();
        eventMessageSocket.connect(Config.eventSocketUrl, function() { on_connect(); });
        eventMessageSocket.addJSONListener(   on_msg);
        eventMessageSocket.addBinaryListener( function(data) { console.warn("WARNING Event Channel Binary Data!"); });
      };
  }])
;
// Generic BULKIO ProtoBuf decoder.  
// get() Returns BULKIO plus dataBuffer matching type or null (if no match)
// controlWidth() Returns Control message
angular.module('redhawk.sockets')
  .service('BulkioPB2', [
    function () {
      var Decoder = dcodeIO.ProtoBuf.loadProtoFile("/protobuf/bulkio.proto").build();

      // Converts raw binary to BULKIO packet
      this.get = function(raw) {
        var pkt = Decoder.BULKIO.decode(raw);

        var type = null;
        switch (pkt.type) {
          case Decoder.BULKIO.TYPE.Char      : 
            type = '.DataChar.bulkio';
            break;
          case Decoder.BULKIO.TYPE.Short     : 
            type = '.DataShort.bulkio';
            break;
          case Decoder.BULKIO.TYPE.Long      : 
            type = '.DataLong.bulkio';
            break;
          case Decoder.BULKIO.TYPE.LongLong  : 
            type = '.DataLongLong.bulkio';
            break;
          case Decoder.BULKIO.TYPE.ULong     : 
            type = '.DataULong.bulkio';
            break;
          case Decoder.BULKIO.TYPE.ULongLong : 
            type = '.DataULongLong.bulkio';
            break;
          case Decoder.BULKIO.TYPE.Float     : 
            type = '.DataFloat.bulkio';
            break;
          case Decoder.BULKIO.TYPE.Double    : 
            type = '.DataDouble.bulkio';
            break;
          default:
            break;
        }

        angular.extend(pkt, { dataBuffer : (type ? (pkt[type] ? pkt[type].dataBuffer: null) : null) });
        return pkt;
      }

      this.dataTypes = Decoder.BULKIO.TYPE;
      this.sriModes = Decoder.SRI.MODE;

      // Creates a Control message for MaxWidth
      this.controlWidth = function(width) {
        var c = new Decoder.Control();
        c.type = Decoder.Control.TYPE.MaxWidth;
        c.value = width;
        return c;
      }
    }])
;
/**
 * Convenience class to add a listener pattern to the standard WebSocket
 *
 */
angular.module('redhawk.sockets')
  .factory('Subscription', ['$rootScope', 
    function ($rootScope) {
      var Subscription = function() {
        var self = this;
        //////// PUBLIC INTERFACES  (immutable) ////////
        self.connect = connect;
        self.send = send;
        self.close = close;

        // Listener management
        self.addJSONListener = addJSONListener;
        self.addBinaryListener = addBinaryListener;
        self.removeJSONListener = removeJSONListener;
        self.removeBinaryListener = removeBinaryListener;

        //////// DEFINITIONS BELOW //////////

        /*
         * Connect to the websocket at the given path URL.
         * Callback will be called if connected.
         */
        function connect (path_, callback) {
          path = path_;
          ws = new WebSocket(path);

          ws.onopen = function (data) {
            console.debug("Socket opened: " + path);
            ws.binaryType = "arraybuffer";
            callback.call(ws, data);

            // If the outbound queue has been filling, send all now.
            var l = delayOutQueue.length;
            while (l--) {
              self.send(delayOutQueue[l]);
              delayOutQueue.splice(l, 1);
            }
          };

          // Process each message.  Binary is a pass-through,
          // JSON data is parsed first into objects, then passed.
          ws.onmessage = function (e) {
            if (e.data instanceof ArrayBuffer) {
              relay.call(self, callbacks.binary, e.data);
            } 
            else {
              var reg = /:\s?(Infinity|-Infinity|NaN)\s?\,/g;
              var myData = e.data.replace(reg, ": \"$1\", ");
              relay.call(self, callbacks.json, JSON.parse(myData));
            }
          };
        }

        /* 
         * Add this callback to the JSON listeners
         * Messages received will be JSON structures converted to JS entities.
         */
        function addJSONListener  (callback) { callbacks.json.push(callback); }

        /*
         * Add a callback to the Binary listeners
         * Messages received will be binary character strings
         * (Good for protobufs, BULKIO, etc.)
         */
        function addBinaryListener  (callback) { callbacks.binary.push(callback); }

        /* 
         * Remove callback from JSON Listeners
         */
        function removeJSONListener (callback) { remove(callback, callbacks.json); }

        /*
         * Remove callback from Binary Listeners
         */
        function removeBinaryListener (callback) { remove(callback, callbacks.binary); }

        /*
         * Send data on the websocket
         */
        function send  (data) {
          if (undefined == ws || ws.readyState != WebSocket.OPEN) 
            delayOutQueue.push(data);
          else 
            ws.send(data);
        }

        /*
         * Close the websocket.  Generally, it's a good idea to 
         * close the connection when it is no longer necessary,
         * i.e., a Controller is being destroyed in the UI that 
         * created an instance of this factory.
         */
        function close () {
          if (ws) {
            ws.close();
            console.log("Socket closed: " + path);
          }
        }



        //////// INTERNAL ////////


        // path - the URL to which this socket is connected.
        var path = undefined;
        var ws = undefined;
        var callbacks = {
          message: [],
          json: [],
          binary: []
        };
        var delayOutQueue = [];

        // Simple remove-from-list function.
        var remove = function(callback, callbacks) {
          var i = callbacks.indexOf(callback);
          if (-1 < i)
            callbacks.splice(i, 1);
        }

        // Moves each listener callback up to the right scope before calling it.
        var relay = function (callbacks, data) {
          var scope = this;
          angular.forEach(callbacks, function (callback) {
            $rootScope.$apply(function () {
              callback.call(scope, data);
            });
          });
        }
      }

      return Subscription;
    }])
;
// Global utility functions
var UtilityFunctions = UtilityFunctions || {

  /* 
   * Returns items in oldList not found in newList
   */
  filterOldList : function(oldList, newList) {
    var out = [];
    var unique = true;
    for (var oldI = 0; oldI < oldList.length; oldI++) {
      for (var newI = 0; newI < newList.length; newI++) {
        if (oldList[oldI] == newList[newI]) {
          unique = false;
          break;
        }
      }
      if (unique) 
        out.push(oldList[oldI]);
      unique = true;
    }
    return out;
  },

  /* 
   * Loops through a list of properties and returns the one of matching id (or undefined)
   */
  findPropId : function (properties, propId) {
    for (var i = 0; i < properties.length; i++) {
      if (propId == properties[i].id)
        return properties[i];
    }
    return undefined;
  },
};
/*
  The NotificationService can be used to post simple notifications into the active
  browser UI.  One such example is from the Domain factory launching waveforms.
  This service is relatively unmodified from its admin-console version.
 */
angular.module('redhawk.util')
  .service('NotificationService', ['toastr',
    function(toastr){
      var self = this;

      self.msg = function(severity, message, subject) {
        var title = subject || severity.toUpperCase();

        console.log("["+severity.toUpperCase()+"] :: "+message);
        switch (severity) {
          case 'error':
            toastr.error(message, title);
            break;
          case 'success':
            toastr.success(message, title);
            break;
          case 'info':
          default:
            toastr.info(message, title);
            break;
        }
      };

      self.error = function(text, subject) {
        self.msg("error", text, subject);
      };
      self.info = function(text, subject) {
        self.msg("info", text, subject);
      };
      self.success = function(text, subject) {
        self.msg("success", text, subject);
      };
    }
  ])
;

/*
  Extendable Angular-REDHAWK factory represents a single Waveform instance.

  An instance, or its extension, can be retrieved from a REDHAWK Domain instance
  using the getWaveform(id, <extension name>) method.
 */
angular.module('redhawk')
  .factory('Waveform', ['Config', 'REST', 'RESTPortBearer', 'NotificationService', 'Config',
    function(Config, REST, RESTPortBearer, NotificationService, Config) {
      var Waveform = function(id, domainId) {
        var self = this;

        // Inherited setup
        RESTPortBearer.apply(self, arguments);
        self._portConfigUrl = Config.waveformPortUrl;

        //////// PUBLIC Interfaces (immutable) /////////
        // Methods
        self.start = start;
        self.stop = stop;
        self.release = release;
        self.configure = configure;
        self.refresh = refresh;


        //////// Definitions ////////

        /**
         * Start the Waveform
         * @returns {*}
         */
        function start () {
          return REST.waveform.update(self._restArgs, {started: true},
            function() {
              notify.success("Waveform "+self.name+" started.");
              _reload();
            },
            function() {
              notify.error("Waveform "+self.name+" failed to start.")
            }
          );
        }

        /**
         * Stop the Waveform
         * @returns {*}
         */
        function stop () {
          return REST.waveform.update( self._restArgs, {started: false},
            function() { 
              notify.success("Waveform "+self.name+" stopped.");
              _reload();
            },
            function() {  
              notify.error("Waveform "+self.name+" failed to stop.");
            }
          );
        }

        /**
         * Release (delete) the Waveform
         * @returns {*}
         */
        function release () {
          return REST.waveform.release( self._restArgs, {},
            function() { notify.success("Waveform "+self.name+" released.");        },
            function() { notify.error("Waveform "+self.name+" failed to release."); }
          );
        }

        /**
         * @see {Domain.configure()}
         */
        function configure (properties) {
          return REST.waveform.configure(self._restArgs, {properties: properties});
        }

        /*
         * Refresh the REST model
         */
        function refresh () { _reload; }
        
        //////// Internal ////////


        // Service for popping up indications when the waveform changes state
        var notify = NotificationService;

        /**
         * @see {Domain._load()}
         */
        function _load (id, domainId) {
          self._restArgs = { applicationId: id, domainId: domainId };
          self.$promise = REST.waveform.query(self._restArgs, 
            function(data){
              self.id = id;
              self.domainId = domainId;
              self._update(data);
            }).$promise;
        }

        /**
         * @see {Domain._reload()}
         */
        function _reload () { _load(self.id, self.domainId); }

        _load(id, domainId);
      };

      Waveform.prototype = Object.create(RESTPortBearer.prototype);
      Waveform.prototype.constructor = Waveform;
      return Waveform;
    }
  ])
;
var ArrayBuffer,ArrayBufferView,Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView;
(function(){function e(){document&&document.createTextNode("").splitText(1);throw new RangeError("INDEX_SIZE_ERR");}function a(c){if(Object.getOwnPropertyNames&&Object.defineProperty){var q=Object.getOwnPropertyNames(c),s;for(s=0;s<q.length;s+=1)Object.defineProperty(c,q[s],{value:c[q[s]],writable:!1,enumerable:!1,configurable:!1})}}function d(c){function q(s){Object.defineProperty(c,s,{get:function(){return c._getter(s)},set:function(q){c._setter(s,q)},enumerable:!0,configurable:!1})}if(Object.defineProperty){var s;
for(s=0;s<c.length;s+=1)q(s)}}function w(c){return[c&255]}function p(c){return x(c[0],8)}function f(c){return[c&255]}function l(c){return W(c[0],8)}function g(c){return[c>>8&255,c&255]}function k(c){return x(c[0]<<8|c[1],16)}function h(c){return[c>>8&255,c&255]}function B(c){return W(c[0]<<8|c[1],16)}function t(c){return[c>>24&255,c>>16&255,c>>8&255,c&255]}function u(c){return x(c[0]<<24|c[1]<<16|c[2]<<8|c[3],32)}function z(c){return[c>>24&255,c>>16&255,c>>8&255,c&255]}function A(c){return W(c[0]<<
24|c[1]<<16|c[2]<<8|c[3],32)}function E(c){var q=[];for(c=c.join("");c.length;)q.push(parseInt(c.substring(0,8),2)),c=c.substring(8);return q}function I(c){var q=[],s,v;for(s=c.length;s;s-=1)for(b=c[s-1],v=8;v;v-=1)q.push(b%2?1:0),b>>=1;q.reverse();return q}function P(c){return[c&255]}function L(c){return x(c[0],8)}function Q(c){return[c&255]}function K(c){return W(c[0],8)}function F(c){return[c&255,c>>8&255]}function V(c){return x(c[1]<<8|c[0],16)}function c(c){return[c&255,c>>8&255]}function v(c){return W(c[1]<<
8|c[0],16)}function y(c){return[c&255,c>>8&255,c>>16&255,c>>24&255]}function G(c){return x(c[3]<<24|c[2]<<16|c[1]<<8|c[0],32)}function M(c){return[c&255,c>>8&255,c>>16&255,c>>24&255]}function n(c){return W(c[3]<<24|c[2]<<16|c[1]<<8|c[0],32)}function Z(c){var q=[];for(c=c.join("");c.length;)q.push(parseInt(c.substring(c.length-8,c.length),2)),c=c.substring(0,c.length-8);return q}function T(c){var q=[],s,v;for(s=0;s<c.length;s++)for(b=c[s],v=8;v;v-=1)q.push(b%2?1:0),b>>=1;q.reverse();return q}function x(c,
q){var s=32-q;return c<<s>>s}function W(c,q){var s=32-q;return c<<s>>>s}function q(c,q,s){var v=(1<<q-1)-1,r,a,d;isNaN(c)?(a=(1<<v)-1,v=Math.pow(2,s-1),r=0):Infinity===c||-Infinity===c?(a=(1<<v)-1,v=0,r=0>c?1:0):0===c?(v=a=0,r=-Infinity===1/c?1:0):(r=0>c,c=Math.abs(c),c>=Math.pow(2,1-v)?(d=Math.min(Math.floor(Math.log(c)/Math.LN2),v),a=d+v,v=Math.round(c*Math.pow(2,s-d)-Math.pow(2,s))):(a=0,v=Math.round(c/Math.pow(2,1-v-s))));for(c=[];s;s-=1)c.push(v%2?1:0),v=Math.floor(v/2);for(s=q;s;s-=1)c.push(a%
2?1:0),a=Math.floor(a/2);c.push(r?1:0);c.reverse();return $(c)}function s(c,q,s){var v=[],r,a,v=aa(c);r=v.join("");c=(1<<q-1)-1;v=parseInt(r.substring(0,1),2)?-1:1;a=parseInt(r.substring(1,1+q),2);r=parseInt(r.substring(1+q),2);return a===(1<<q)-1?0!==r?NaN:Infinity*v:0<a?v*Math.pow(2,a-c)*(1+r/Math.pow(2,s)):0!==r?v*Math.pow(2,-(c-1))*(r/Math.pow(2,s)):0>v?-0:0}function C(c){return s(c,11,52)}function r(c){return q(c,11,52)}function D(c){return s(c,8,23)}function H(c){return q(c,8,23)}var J={ToInt32:function(c){return c>>
0},ToUint32:function(c){return c>>>0}};Object.prototype.__defineGetter__&&!Object.defineProperty&&(Object.defineProperty=function(c,q,s){s.hasOwnProperty("get")&&c.__defineGetter__(q,s.get);s.hasOwnProperty("set")&&c.__defineSetter__(q,s.set)});var N=window.BIG_ENDIAN_ARRAYBUFFERS?w:P,O=window.BIG_ENDIAN_ARRAYBUFFERS?p:L,ba=window.BIG_ENDIAN_ARRAYBUFFERS?f:Q,ca=window.BIG_ENDIAN_ARRAYBUFFERS?l:K,R=window.BIG_ENDIAN_ARRAYBUFFERS?g:F,U=window.BIG_ENDIAN_ARRAYBUFFERS?k:V,Y=window.BIG_ENDIAN_ARRAYBUFFERS?
h:c,S=window.BIG_ENDIAN_ARRAYBUFFERS?B:v,da=window.BIG_ENDIAN_ARRAYBUFFERS?t:y,ea=window.BIG_ENDIAN_ARRAYBUFFERS?u:G,fa=window.BIG_ENDIAN_ARRAYBUFFERS?z:M,ga=window.BIG_ENDIAN_ARRAYBUFFERS?A:n,$=window.BIG_ENDIAN_ARRAYBUFFERS?E:Z,aa=window.BIG_ENDIAN_ARRAYBUFFERS?I:T;ArrayBuffer||function(){function c(q,s,v){var r;r=function(c,q,s){var v,y,C;if(arguments.length&&"number"!==typeof arguments[0])if("object"===typeof arguments[0]&&arguments[0].constructor===r)for(v=arguments[0],this.length=v.length,this.byteLength=
this.length*this.BYTES_PER_ELEMENT,this.buffer=new ArrayBuffer(this.byteLength),y=this.byteOffset=0;y<this.length;y+=1)this._setter(y,v._getter(y));else if("object"!==typeof arguments[0]||arguments[0]instanceof ArrayBuffer)if("object"===typeof arguments[0]&&arguments[0]instanceof ArrayBuffer){this.buffer=c;this.byteOffset=J.ToUint32(q);this.byteOffset>this.buffer.byteLength&&e();if(this.byteOffset%this.BYTES_PER_ELEMENT)throw new RangeError("ArrayBuffer length minus the byteOffset is not a multiple of the element size.");
3>arguments.length?(this.byteLength=this.buffer.byteLength-this.byteOffset,this.byteLength%this.BYTES_PER_ELEMENT&&e(),this.length=this.byteLength/this.BYTES_PER_ELEMENT):(this.length=J.ToUint32(s),this.byteLength=this.length*this.BYTES_PER_ELEMENT);this.byteOffset+this.byteLength>this.buffer.byteLength&&e()}else throw new TypeError("Unexpected argument type(s)");else for(v=arguments[0],this.length=J.ToUint32(v.length),this.byteLength=this.length*this.BYTES_PER_ELEMENT,this.buffer=new ArrayBuffer(this.byteLength),
y=this.byteOffset=0;y<this.length;y+=1)C=v[y],this._setter(y,Number(C));else{this.length=J.ToInt32(arguments[0]);if(0>s)throw new RangeError("ArrayBufferView size is not a small enough positive integer.");this.byteLength=this.length*this.BYTES_PER_ELEMENT;this.buffer=new ArrayBuffer(this.byteLength);this.byteOffset=0}this.constructor=r;a(this);d(this)};r.prototype=new ArrayBufferView;r.prototype.BYTES_PER_ELEMENT=q;r.prototype.emulated=!0;r.prototype._pack=s;r.prototype._unpack=v;r.BYTES_PER_ELEMENT=
q;r.prototype._getter=function(c){if(1>arguments.length)throw new SyntaxError("Not enough arguments");c=J.ToUint32(c);if(!(c>=this.length)){var q=[],s,v;s=0;for(v=this.byteOffset+c*this.BYTES_PER_ELEMENT;s<this.BYTES_PER_ELEMENT;s+=1,v+=1)q.push(this.buffer._bytes[v]);return this._unpack(q)}};r.prototype.get=r.prototype._getter;r.prototype._setter=function(c,q){if(2>arguments.length)throw new SyntaxError("Not enough arguments");c=J.ToUint32(c);if(!(c>=this.length)){var s=this._pack(q),v,r;v=0;for(r=
this.byteOffset+c*this.BYTES_PER_ELEMENT;v<this.BYTES_PER_ELEMENT;v+=1,r+=1)this.buffer._bytes[r]=s[v]}};r.prototype.set=function(c,q){if(1>arguments.length)throw new SyntaxError("Not enough arguments");var s,v,r,a,d,y;if("object"===typeof arguments[0]&&arguments[0].constructor===this.constructor)if(s=arguments[0],v=J.ToUint32(arguments[1]),v+s.length>this.length&&e(),y=this.byteOffset+v*this.BYTES_PER_ELEMENT,v=s.length*this.BYTES_PER_ELEMENT,s.buffer===this.buffer){r=[];a=0;for(d=s.byteOffset;a<
v;a+=1,d+=1)r[a]=s.buffer._bytes[d];for(a=0;a<v;a+=1,y+=1)this.buffer._bytes[y]=r[a]}else for(a=0,d=s.byteOffset;a<v;a+=1,d+=1,y+=1)this.buffer._bytes[y]=s.buffer._bytes[d];else if("object"===typeof arguments[0]&&"undefined"!==typeof arguments[0].length)for(s=arguments[0],r=J.ToUint32(s.length),v=J.ToUint32(arguments[1]),v+r>this.length&&e(),a=0;a<r;a+=1)d=s[a],this._setter(v+a,Number(d));else throw new TypeError("Unexpected argument type(s)");};r.prototype.subarray=function(c,q){c=J.ToInt32(c);q=
J.ToInt32(q);1>arguments.length&&(c=0);2>arguments.length&&(q=this.length);0>c&&(c=this.length+c);0>q&&(q=this.length+q);var s=this.length;c=0>c?0:c>s?s:c;s=this.length;s=(0>q?0:q>s?s:q)-c;0>s&&(s=0);return new this.constructor(this.buffer,c*this.BYTES_PER_ELEMENT,s)};return r}ArrayBuffer=function(c){c=J.ToInt32(c);if(0>c)throw new RangeError("ArrayBuffer size is not a small enough positive integer.");this.byteLength=c;this._bytes=[];this._bytes.length=c;for(c=0;c<this.byteLength;c+=1)this._bytes[c]=
0;a(this)};ArrayBuffer.isNative=!1;ArrayBufferView=function(){};Int8Array=Int8Array||c(1,N,O);Uint8Array=Uint8Array||c(1,ba,ca);Int16Array=Int16Array||c(2,R,U);Uint16Array=Uint16Array||c(2,Y,S);Int32Array=Int32Array||c(4,da,ea);Uint32Array=Uint32Array||c(4,fa,ga);Float32Array=Float32Array||c(4,H,D);Float64Array=Float64Array||c(8,r,C)}();DataView||function(){function c(q,s){return"function"===typeof q.get?q.get(s):q[s]}function q(s){return function(q,r){q=J.ToUint32(q);q+s.BYTES_PER_ELEMENT>this.byteLength&&
e();q+=this.byteOffset;var a=new Uint8Array(this.buffer,q,s.BYTES_PER_ELEMENT),d=[],y;for(y=0;y<s.BYTES_PER_ELEMENT;y+=1)d.push(c(a,y));Boolean(r)===Boolean(v)&&d.reverse();return c(new s((new Uint8Array(d)).buffer),0)}}function s(q){return function(s,r,a){s=J.ToUint32(s);s+q.BYTES_PER_ELEMENT>this.byteLength&&e();r=new q([r]);r=new Uint8Array(r.buffer);var d=[],y;for(y=0;y<q.BYTES_PER_ELEMENT;y+=1)d.push(c(r,y));Boolean(a)===Boolean(v)&&d.reverse();(new Uint8Array(this.buffer,s,q.BYTES_PER_ELEMENT)).set(d)}}
var v=function(){var q=new Uint16Array([4660]),q=new Uint8Array(q.buffer);return 18===c(q,0)}();DataView=function(c,q,s){if(!("object"===typeof c&&c instanceof ArrayBuffer))throw new TypeError("TypeError");this.buffer=c;this.byteOffset=J.ToUint32(q);this.byteOffset>this.buffer.byteLength&&e();this.byteLength=3>arguments.length?this.buffer.byteLength-this.byteOffset:J.ToUint32(s);this.byteOffset+this.byteLength>this.buffer.byteLength&&e();a(this)};ArrayBufferView&&(DataView.prototype=new ArrayBufferView);
DataView.prototype.getUint8=q(Uint8Array);DataView.prototype.getInt8=q(Int8Array);DataView.prototype.getUint16=q(Uint16Array);DataView.prototype.getInt16=q(Int16Array);DataView.prototype.getUint32=q(Uint32Array);DataView.prototype.getInt32=q(Int32Array);DataView.prototype.getFloat32=q(Float32Array);DataView.prototype.getFloat64=q(Float64Array);DataView.prototype.setUint8=s(Uint8Array);DataView.prototype.setInt8=s(Int8Array);DataView.prototype.setUint16=s(Uint16Array);DataView.prototype.setInt16=s(Int16Array);
DataView.prototype.setUint32=s(Uint32Array);DataView.prototype.setInt32=s(Int32Array);DataView.prototype.setFloat32=s(Float32Array);DataView.prototype.setFloat64=s(Float64Array)}()})();window.ArrayBuffer&&!ArrayBuffer.prototype.slice&&(ArrayBuffer.prototype.slice=function(e,a){var d=new Uint8Array(this);void 0===a&&(a=d.length);for(var w=new ArrayBuffer(a-e),p=new Uint8Array(w),f=0;f<p.length;f++)p[f]=d[f+e];return w});
Array.prototype.remove=function(e,a){var d=this.slice((a||e)+1||this.length);this.length=0>e?this.length+e:e;return this.push.apply(this,d)};window.requestAnimFrame=function(e){return window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.oRequestAnimationFrame||window.msRequestAnimationFrame||function(a){return window.setTimeout(a,1E3/60)}}();
window.cancelAnimFrame=function(e){return window.cancelAnimationFrame||window.webkitCancelAnimationFrame||window.mozCancelAnimationFrame||window.oCancelAnimationFrame||window.msCanelAnimationFrame||function(a){window.clearTimeout(a)}}();function dashOn(e,a,d){return e.setLineDash?(e.setLineDash([a,d]),!0):void 0!==e.mozDash?(e.mozDash=[a,d],!0):e.webkitLineDash&&0===e.webkitLineDash.length?(e.webkitLineDash=[a,d],!0):!1}
function dashOff(e){e.setLineDash?e.setLineDash([]):e.mozDash?e.mozDash=null:e.webkitLineDash&&(e.webkitLineDash=[])}function getKeyCode(e){e=window.event||e;return e=e.charCode||e.keyCode}function setKeypressHandler(e){window.addEventListener?window.addEventListener("keypress",e,!1):window.attachEvent&&window.attachEvent("onkeypress",e)}Array.isArray||(Array.isArray=function(e){return"[object Array]"===Object.prototype.toString.call(e)});
window.Float64Array||(window.Float64Array=function(){return window.Float64Array||function(e,a,d){if(!(e instanceof ArrayBuffer))throw"Invalid type";var w=new DataView(e),p=[];e=(e.byteLength-a)/8;p.length=void 0===d?e:Math.min(d,e);for(d=0;d<p.length;d++)p[d]=w.getFloat64(8*d+a,!0);p.subarray=function(a,d){return p.slice(a,d)};return p}}());
(function(){var e=function(){};window.console||(window.console={log:e,info:e,warn:e,debug:e,error:e});if((new Int8Array([0,1,0])).subarray(1).subarray(1)[0]){var a=function(a,e){0===arguments.length?(a=0,e=this.length):(0>a&&(a+=this.length),a=Math.max(0,Math.min(this.length,a)),1===arguments.length?e=this.length:(0>e&&(e+=this.length),e=Math.max(a,Math.min(this.length,e))));return new this.constructor(this.buffer,this.byteOffset+a*this.BYTES_PER_ELEMENT,e-a)};[Int8Array,Uint8Array,Int16Array,Uint16Array,
Int32Array,Uint32Array,Float32Array,Float64Array].forEach(function(d){d.prototype.subarray=a})}})();
(function(e,a){function d(a,d,k,h){a[p](w+d,"wheel"===f?k:function(a){!a&&(a=e.event);var d={originalEvent:a,target:a.target||a.srcElement,type:"wheel",deltaMode:"MozMousePixelScroll"===a.type?0:1,deltaX:0,delatZ:0,preventDefault:function(){a.preventDefault?a.preventDefault():a.returnValue=!1}};"mousewheel"===f?(d.deltaY=-0.025*a.wheelDelta,a.wheelDeltaX&&(d.deltaX=-0.025*a.wheelDeltaX)):d.deltaY=a.detail;return k(d)},h||!1)}var w="",p,f;e.addEventListener?p="addEventListener":(p="attachEvent",w=
"on");f="onwheel"in a.createElement("div")?"wheel":void 0!==a.onmousewheel?"mousewheel":"DOMMouseScroll";e.addWheelListener=function(a,e,k){d(a,f,e,k);"DOMMouseScroll"===f&&d(a,"MozMousePixelScroll",e,k)}})(window,document);
(function(e){function a(a){a=new Uint8Array(a);if(B)return String.fromCharCode.apply(null,a);for(var d="",e=0;e<a.length;e++)d+=String.fromCharCode(a[e]);return d}function d(d){this.file_name=this.file=null;this.offset=0;this.buf=d;if(null!=this.buf){d=new DataView(this.buf);this.version=a(this.buf.slice(0,4));this.headrep=a(this.buf.slice(4,8));this.datarep=a(this.buf.slice(8,12));var e="EEEI"===this.headrep,f="EEEI"===this.datarep;this.type=d.getUint32(48,e);this["class"]=this.type/1E3;this.format=
a(this.buf.slice(52,54));this.timecode=d.getFloat64(56,e);1===this["class"]?(this.xstart=d.getFloat64(256,e),this.xdelta=d.getFloat64(264,e),this.xunits=d.getInt32(272,e),this.yunits=d.getInt32(296,e),this.subsize=1):2===this["class"]&&(this.xstart=d.getFloat64(256,e),this.xdelta=d.getFloat64(264,e),this.xunits=d.getInt32(272,e),this.subsize=d.getInt32(276,e),this.ystart=d.getFloat64(280,e),this.ydelta=d.getFloat64(288,e),this.yunits=d.getInt32(296,e));this.data_start=d.getFloat64(32,e);this.data_size=
d.getFloat64(40,e);this.setData(this.buf,this.data_start,this.data_start+this.data_size,f)}}function w(a){var d=document.createElement("a");d.href=a;for(var e=d.protocol.replace(":",""),f=d.hostname,g=d.port,l=d.search,k={},h=d.search.replace(/^\?/,"").split("&"),F=h.length,p=0,c;p<F;p++)h[p]&&(c=h[p].split("="),k[c[0]]=c[1]);return{source:a,protocol:e,host:f,port:g,query:l,params:k,file:(d.pathname.match(/\/([^\/?#]+)$/i)||[null,""])[1],hash:d.hash.replace("#",""),path:d.pathname.replace(/^([^\/])/,
"/$1"),relative:(d.href.match(/tps?:\/\/[^\/]+(.+)/)||[null,""])[1],segments:d.pathname.replace(/^\//,"").split("/")}}function p(a,d,e){e=e||1024;var f=0,g=new ArrayBuffer(a.length),l=new Uint8Array(g),k=function(){for(var h=f+e;f<h;f++)l[f]=a.charCodeAt(f)&255;f>=a.length?d(g):setTimeout(k,0)};setTimeout(k,0)}function f(a){this.options=a}navigator.userAgent.match(/(iPad|iPhone|iPod)/i);var l=function(){var a=new ArrayBuffer(4),d=new Uint32Array(a),a=new Uint8Array(a);d[0]=3735928559;if(239===a[0])return"LE";
if(222===a[0])return"BE";throw Error("unknown endianness");}(),g={S:1,C:2,V:3,Q:4,M:9,X:10,T:16,U:1,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9},k={P:0.125,A:1,O:1,B:1,I:2,L:4,X:8,F:4,D:8},h={P:null,A:null,O:Uint8Array,B:Int8Array,I:Int16Array,L:Int32Array,X:null,F:Float32Array,D:Float64Array},B=!0;try{var t=new Uint8Array(new ArrayBuffer(4));t[0]=66;t[1]=76;t[2]=85;t[3]=69;"BLUE"!==String.fromCharCode.apply(null,t)&&(B=!1)}catch(u){B=!1}d.prototype={setData:function(a,d,e,f){1===this["class"]?(this.spa=
g[this.format[0]],this.bps=k[this.format[1]],this.bpa=this.spa*this.bps,this.ape=1,this.bpe=this.ape*this.bpa):2===this["class"]&&(this.spa=g[this.format[0]],this.bps=k[this.format[1]],this.bpa=this.spa*this.bps,this.ape=this.subsize,this.bpe=this.ape*this.bpa);void 0===f&&(f="LE"===l);if("LE"===l&&!f)throw"Not supported "+l+" "+f;if("BE"===l&&this.littleEndianData)throw"Not supported "+l+" "+f;a?(this.dview=d&&e?this.createArray(a,d,(e-d)/this.bps):this.createArray(a),this.size=this.dview.length/
(this.spa*this.ape)):this.dview=this.createArray(null,null,this.size)},createArray:function(a,d,e){var f=h[this.format[1]];if(void 0===f)throw"unknown format "+this.format[1];void 0===d&&(d=0);void 0===e&&(e=a.length||a.byteLength/k[this.format[1]]);return a?new f(a,d,e):new f(e)}};f.prototype={readheader:function(a,e){var f=new FileReader,g=a.webkitSlice(0,512);f.onloadend=function(a){return function(g){g.target.error?e(null):(g=new d(f.result),g.file=a,e(g))}}(a);f.readAsArrayBuffer(g)},read:function(a,
e){var f=new FileReader;f.onloadend=function(a){return function(g){g.target.error?e(null):(g=new d(f.result),g.file=a,g.file_name=a.name,e(g))}}(a);f.readAsArrayBuffer(a)},read_http:function(a,e){var f=new XMLHttpRequest;f.open("GET",a,!0);f.responseType="arraybuffer";f.overrideMimeType("text/plain; charset=x-user-defined");f.onload=function(g){if(4!==f.readyState||200!==f.status&&0!==f.status)e(null);else if(g=null,f.response){g=f.response;g=new d(g);w(a);var l=w(a);g.file_name=l.file;e(g)}else f.responseText&&
p(f.responseText,function(f){f=new d(f);w(a);var g=w(a);f.file_name=g.file;e(f)})};f.onerror=function(a){e(null)};f.send(null)}};e.BlueHeader=e.BlueHeader||d;e.BlueFileReader=e.BlueFileReader||f})(this);
(function(e){function a(e,h){e=e?e:"";h=h||{};if("object"==typeof e&&e.hasOwnProperty("_tc_id"))return e;var c=d(e),v=c.r,y=c.g,G=c.b,M=c.a,n=A(100*M)/100,Z=h.format||c.format;1>v&&(v=A(v));1>y&&(y=A(y));1>G&&(G=A(G));return{ok:c.ok,format:Z,_tc_id:u++,alpha:M,toHsv:function(){var c=f(v,y,G);return{h:360*c.h,s:c.s,v:c.v,a:M}},toHsvString:function(){var c=f(v,y,G),a=A(360*c.h),d=A(100*c.s),c=A(100*c.v);return 1==M?"hsv("+a+", "+d+"%, "+c+"%)":"hsva("+a+", "+d+"%, "+c+"%, "+n+")"},toHsl:function(){var c=
w(v,y,G);return{h:360*c.h,s:c.s,l:c.l,a:M}},toHslString:function(){var c=w(v,y,G),a=A(360*c.h),d=A(100*c.s),c=A(100*c.l);return 1==M?"hsl("+a+", "+d+"%, "+c+"%)":"hsla("+a+", "+d+"%, "+c+"%, "+n+")"},toHex:function(c){return l(v,y,G,c)},toHexString:function(c){return"#"+l(v,y,G,c)},toRgb:function(){return{r:A(v),g:A(y),b:A(G),a:M}},toRgbString:function(){return 1==M?"rgb("+A(v)+", "+A(y)+", "+A(G)+")":"rgba("+A(v)+", "+A(y)+", "+A(G)+", "+n+")"},toPercentageRgb:function(){return{r:A(100*g(v,255))+
"%",g:A(100*g(y,255))+"%",b:A(100*g(G,255))+"%",a:M}},toPercentageRgbString:function(){return 1==M?"rgb("+A(100*g(v,255))+"%, "+A(100*g(y,255))+"%, "+A(100*g(G,255))+"%)":"rgba("+A(100*g(v,255))+"%, "+A(100*g(y,255))+"%, "+A(100*g(G,255))+"%, "+n+")"},toName:function(){return 0===M?"transparent":Q[l(v,y,G,!0)]||!1},toFilter:function(c){var d=l(v,y,G),e=d,q=Math.round(255*parseFloat(M)).toString(16),s=q,C=h&&h.gradientType?"GradientType = 1, ":"";c&&(c=a(c),e=c.toHex(),s=Math.round(255*parseFloat(c.alpha)).toString(16));
return"progid:DXImageTransform.Microsoft.gradient("+C+"startColorstr=#"+k(q)+d+",endColorstr=#"+k(s)+e+")"},toString:function(c){var v=!!c;c=c||this.format;var a=!1,v=!v&&1>M&&0<M&&("hex"===c||"hex6"===c||"hex3"===c||"name"===c);"rgb"===c&&(a=this.toRgbString());"prgb"===c&&(a=this.toPercentageRgbString());if("hex"===c||"hex6"===c)a=this.toHexString();"hex3"===c&&(a=this.toHexString(!0));"name"===c&&(a=this.toName());"hsl"===c&&(a=this.toHslString());"hsv"===c&&(a=this.toHsvString());return v?this.toRgbString():
a||this.toHexString()}}}function d(a){var d={r:0,g:0,b:0},c=1,v=!1,y=!1;if("string"==typeof a)a:{a=a.replace(B,"").replace(t,"").toLowerCase();var e=!1;if(L[a])a=L[a],e=!0;else if("transparent"==a){a={r:0,g:0,b:0,a:0,format:"name"};break a}var f;a=(f=K.rgb.exec(a))?{r:f[1],g:f[2],b:f[3]}:(f=K.rgba.exec(a))?{r:f[1],g:f[2],b:f[3],a:f[4]}:(f=K.hsl.exec(a))?{h:f[1],s:f[2],l:f[3]}:(f=K.hsla.exec(a))?{h:f[1],s:f[2],l:f[3],a:f[4]}:(f=K.hsv.exec(a))?{h:f[1],s:f[2],v:f[3]}:(f=K.hex6.exec(a))?{r:parseInt(f[1],
16),g:parseInt(f[2],16),b:parseInt(f[3],16),format:e?"name":"hex"}:(f=K.hex3.exec(a))?{r:parseInt(f[1]+""+f[1],16),g:parseInt(f[2]+""+f[2],16),b:parseInt(f[3]+""+f[3],16),format:e?"name":"hex"}:!1}if("object"==typeof a){if(a.hasOwnProperty("r")&&a.hasOwnProperty("g")&&a.hasOwnProperty("b"))d=a.g,v=a.b,d={r:255*g(a.r,255),g:255*g(d,255),b:255*g(v,255)},v=!0,y="%"===String(a.r).substr(-1)?"prgb":"rgb";else if(a.hasOwnProperty("h")&&a.hasOwnProperty("s")&&a.hasOwnProperty("v")){a.s=h(a.s);a.v=h(a.v);
var y=a.h,e=a.s,d=a.v,y=6*g(y,360),e=g(e,100),d=g(d,100),v=z.floor(y),n=y-v,y=d*(1-e);f=d*(1-n*e);e=d*(1-(1-n)*e);v%=6;d={r:255*[d,f,y,y,e,d][v],g:255*[e,d,d,f,y,y][v],b:255*[y,y,e,d,d,f][v]};v=!0;y="hsv"}else a.hasOwnProperty("h")&&a.hasOwnProperty("s")&&a.hasOwnProperty("l")&&(a.s=h(a.s),a.l=h(a.l),d=p(a.h,a.s,a.l),v=!0,y="hsl");a.hasOwnProperty("a")&&(c=a.a)}c=parseFloat(c);if(isNaN(c)||0>c||1<c)c=1;return{ok:v,format:a.format||y,r:E(255,I(d.r,0)),g:E(255,I(d.g,0)),b:E(255,I(d.b,0)),a:c}}function w(a,
d,c){a=g(a,255);d=g(d,255);c=g(c,255);var v=I(a,d,c),y=E(a,d,c),e,f=(v+y)/2;if(v==y)e=y=0;else{var n=v-y,y=0.5<f?n/(2-v-y):n/(v+y);switch(v){case a:e=(d-c)/n+(d<c?6:0);break;case d:e=(c-a)/n+2;break;case c:e=(a-d)/n+4}e/=6}return{h:e,s:y,l:f}}function p(a,d,c){function v(c,v,a){0>a&&(a+=1);1<a&&(a-=1);return a<1/6?c+6*(v-c)*a:0.5>a?v:a<2/3?c+(v-c)*(2/3-a)*6:c}a=g(a,360);d=g(d,100);c=g(c,100);if(0===d)c=d=a=c;else{var y=0.5>c?c*(1+d):c+d-c*d,e=2*c-y;c=v(e,y,a+1/3);d=v(e,y,a);a=v(e,y,a-1/3)}return{r:255*
c,g:255*d,b:255*a}}function f(a,d,c){a=g(a,255);d=g(d,255);c=g(c,255);var v=I(a,d,c),y=E(a,d,c),e,f=v-y;if(v==y)e=0;else{switch(v){case a:e=(d-c)/f+(d<c?6:0);break;case d:e=(c-a)/f+2;break;case c:e=(a-d)/f+4}e/=6}return{h:e,s:0===v?0:f/v,v:v}}function l(a,d,c,v){a=[k(A(a).toString(16)),k(A(d).toString(16)),k(A(c).toString(16))];return v&&a[0].charAt(0)==a[0].charAt(1)&&a[1].charAt(0)==a[1].charAt(1)&&a[2].charAt(0)==a[2].charAt(1)?a[0].charAt(0)+a[1].charAt(0)+a[2].charAt(0):a.join("")}function g(a,
d){var c=a;"string"==typeof c&&-1!=c.indexOf(".")&&1===parseFloat(c)&&(a="100%");c="string"===typeof a&&-1!=a.indexOf("%");a=E(d,I(0,parseFloat(a)));c&&(a=parseInt(a*d,10)/100);return 1E-6>z.abs(a-d)?1:a%d/parseFloat(d)}function k(a){return 1==a.length?"0"+a:""+a}function h(a){1>=a&&(a=100*a+"%");return a}var B=/^[\s,#]+/,t=/\s+$/,u=0,z=Math,A=z.round,E=z.min,I=z.max,P=z.random;a.fromRatio=function(d,e){if("object"==typeof d){var c={},v;for(v in d)d.hasOwnProperty(v)&&(c[v]="a"===v?d[v]:h(d[v]));
d=c}return a(d,e)};a.equals=function(d,e){return d&&e?a(d).toRgbString()==a(e).toRgbString():!1};a.random=function(){return a.fromRatio({r:P(),g:P(),b:P()})};a.desaturate=function(d,e){e=0===e?0:e||10;var c=a(d).toHsl();c.s-=e/100;c.s=E(1,I(0,c.s));return a(c)};a.saturate=function(d,e){e=0===e?0:e||10;var c=a(d).toHsl();c.s+=e/100;c.s=E(1,I(0,c.s));return a(c)};a.greyscale=function(d){return a.desaturate(d,100)};a.lighten=function(d,e){e=0===e?0:e||10;var c=a(d).toHsl();c.l+=e/100;c.l=E(1,I(0,c.l));
return a(c)};a.darken=function(d,e){e=0===e?0:e||10;var c=a(d).toHsl();c.l-=e/100;c.l=E(1,I(0,c.l));return a(c)};a.complement=function(d){d=a(d).toHsl();d.h=(d.h+180)%360;return a(d)};a.triad=function(d){var e=a(d).toHsl(),c=e.h;return[a(d),a({h:(c+120)%360,s:e.s,l:e.l}),a({h:(c+240)%360,s:e.s,l:e.l})]};a.tetrad=function(d){var e=a(d).toHsl(),c=e.h;return[a(d),a({h:(c+90)%360,s:e.s,l:e.l}),a({h:(c+180)%360,s:e.s,l:e.l}),a({h:(c+270)%360,s:e.s,l:e.l})]};a.splitcomplement=function(d){var e=a(d).toHsl(),
c=e.h;return[a(d),a({h:(c+72)%360,s:e.s,l:e.l}),a({h:(c+216)%360,s:e.s,l:e.l})]};a.analogous=function(d,e,c){e=e||6;c=c||30;var v=a(d).toHsl();c=360/c;d=[a(d)];for(v.h=(v.h-(c*e>>1)+720)%360;--e;)v.h=(v.h+c)%360,d.push(a(v));return d};a.monochromatic=function(d,e){e=e||6;for(var c=a(d).toHsv(),v=c.h,y=c.s,c=c.v,f=[],g=1/e;e--;)f.push(a({h:v,s:y,v:c})),c=(c+g)%1;return f};a.readability=function(d,e){var c=a(d).toRgb(),v=a(e).toRgb(),y=(299*c.r+587*c.g+114*c.b)/1E3,f=(299*v.r+587*v.g+114*v.b)/1E3,c=
Math.max(c.r,v.r)-Math.min(c.r,v.r)+Math.max(c.g,v.g)-Math.min(c.g,v.g)+Math.max(c.b,v.b)-Math.min(c.b,v.b);return{brightness:Math.abs(y-f),color:c}};a.readable=function(d,e){var c=a.readability(d,e);return 125<c.brightness&&500<c.color};a.mostReadable=function(d,e){for(var c=null,v=0,y=!1,f=0;f<e.length;f++){var g=a.readability(d,e[f]),n=125<g.brightness&&500<g.color,g=g.brightness/125*3+g.color/500;if(n&&!y||n&&y&&g>v||!n&&!y&&g>v)y=n,v=g,c=a(e[f])}return c};var L=a.names={aliceblue:"f0f8ff",antiquewhite:"faebd7",
aqua:"0ff",aquamarine:"7fffd4",azure:"f0ffff",beige:"f5f5dc",bisque:"ffe4c4",black:"000",blanchedalmond:"ffebcd",blue:"00f",blueviolet:"8a2be2",brown:"a52a2a",burlywood:"deb887",burntsienna:"ea7e5d",cadetblue:"5f9ea0",chartreuse:"7fff00",chocolate:"d2691e",coral:"ff7f50",cornflowerblue:"6495ed",cornsilk:"fff8dc",crimson:"dc143c",cyan:"0ff",darkblue:"00008b",darkcyan:"008b8b",darkgoldenrod:"b8860b",darkgray:"a9a9a9",darkgreen:"006400",darkgrey:"a9a9a9",darkkhaki:"bdb76b",darkmagenta:"8b008b",darkolivegreen:"556b2f",
darkorange:"ff8c00",darkorchid:"9932cc",darkred:"8b0000",darksalmon:"e9967a",darkseagreen:"8fbc8f",darkslateblue:"483d8b",darkslategray:"2f4f4f",darkslategrey:"2f4f4f",darkturquoise:"00ced1",darkviolet:"9400d3",deeppink:"ff1493",deepskyblue:"00bfff",dimgray:"696969",dimgrey:"696969",dodgerblue:"1e90ff",firebrick:"b22222",floralwhite:"fffaf0",forestgreen:"228b22",fuchsia:"f0f",gainsboro:"dcdcdc",ghostwhite:"f8f8ff",gold:"ffd700",goldenrod:"daa520",gray:"808080",green:"008000",greenyellow:"adff2f",
grey:"808080",honeydew:"f0fff0",hotpink:"ff69b4",indianred:"cd5c5c",indigo:"4b0082",ivory:"fffff0",khaki:"f0e68c",lavender:"e6e6fa",lavenderblush:"fff0f5",lawngreen:"7cfc00",lemonchiffon:"fffacd",lightblue:"add8e6",lightcoral:"f08080",lightcyan:"e0ffff",lightgoldenrodyellow:"fafad2",lightgray:"d3d3d3",lightgreen:"90ee90",lightgrey:"d3d3d3",lightpink:"ffb6c1",lightsalmon:"ffa07a",lightseagreen:"20b2aa",lightskyblue:"87cefa",lightslategray:"789",lightslategrey:"789",lightsteelblue:"b0c4de",lightyellow:"ffffe0",
lime:"0f0",limegreen:"32cd32",linen:"faf0e6",magenta:"f0f",maroon:"800000",mediumaquamarine:"66cdaa",mediumblue:"0000cd",mediumorchid:"ba55d3",mediumpurple:"9370db",mediumseagreen:"3cb371",mediumslateblue:"7b68ee",mediumspringgreen:"00fa9a",mediumturquoise:"48d1cc",mediumvioletred:"c71585",midnightblue:"191970",mintcream:"f5fffa",mistyrose:"ffe4e1",moccasin:"ffe4b5",navajowhite:"ffdead",navy:"000080",oldlace:"fdf5e6",olive:"808000",olivedrab:"6b8e23",orange:"ffa500",orangered:"ff4500",orchid:"da70d6",
palegoldenrod:"eee8aa",palegreen:"98fb98",paleturquoise:"afeeee",palevioletred:"db7093",papayawhip:"ffefd5",peachpuff:"ffdab9",peru:"cd853f",pink:"ffc0cb",plum:"dda0dd",powderblue:"b0e0e6",purple:"800080",red:"f00",rosybrown:"bc8f8f",royalblue:"4169e1",saddlebrown:"8b4513",salmon:"fa8072",sandybrown:"f4a460",seagreen:"2e8b57",seashell:"fff5ee",sienna:"a0522d",silver:"c0c0c0",skyblue:"87ceeb",slateblue:"6a5acd",slategray:"708090",slategrey:"708090",snow:"fffafa",springgreen:"00ff7f",steelblue:"4682b4",
tan:"d2b48c",teal:"008080",thistle:"d8bfd8",tomato:"ff6347",turquoise:"40e0d0",violet:"ee82ee",wheat:"f5deb3",white:"fff",whitesmoke:"f5f5f5",yellow:"ff0",yellowgreen:"9acd32"},Q=a.hexNames=function(a){var d={},c;for(c in a)a.hasOwnProperty(c)&&(d[a[c]]=c);return d}(L),K={rgb:RegExp("rgb[\\s|\\(]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))\\s*\\)?"),rgba:RegExp("rgba[\\s|\\(]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))\\s*\\)?"),
hsl:RegExp("hsl[\\s|\\(]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))\\s*\\)?"),hsla:RegExp("hsla[\\s|\\(]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))\\s*\\)?"),hsv:RegExp("hsv[\\s|\\(]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))[,|\\s]+((?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?))\\s*\\)?"),
hex3:/^([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,hex6:/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/};e.tinycolor=a})(this);
(function(){var e=[];(window.CanvasInput=function(a){var d=this;a=a?a:{};d._canvas=a.canvas||null;d._ctx=d._canvas?d._canvas.getContext("2d"):null;d._x=a.x||0;d._y=a.y||0;d._extraX=a.extraX||0;d._extraY=a.extraY||0;d._fontSize=a.fontSize||14;d._fontFamily=a.fontFamily||"Arial";d._fontColor=a.fontColor||"#000";d._placeHolderColor=a.placeHolderColor||"#bfbebd";d._fontWeight=a.fontWeight||"normal";d._fontStyle=a.fontStyle||"normal";d._readonly=a.readonly||!1;d._maxlength=a.maxlength||null;d._width=a.width||
150;d._height=a.height||d._fontSize;d._padding=0<=a.padding?a.padding:5;d._borderWidth=0<=a.borderWidth?a.borderWidth:1;d._borderColor=a.borderColor||"#959595";d._borderRadius=0<=a.borderRadius?a.borderRadius:3;d._backgroundImage=a.backgroundImage||"";d._boxShadow=a.boxShadow||"1px 1px 0px rgba(255, 255, 255, 1)";d._innerShadow=a.innerShadow||"0px 0px 4px rgba(0, 0, 0, 0.4)";d._selectionColor=a.selectionColor||"rgba(179, 212, 253, 0.8)";d._placeHolder=a.placeHolder||"";d._value=a.value||d._placeHolder;
d._onsubmit=a.onsubmit||function(){};d._onkeydown=a.onkeydown||function(){};d._onkeyup=a.onkeyup||function(){};d._onfocus=a.onfocus||function(){};d._onblur=a.onblur||function(){};d._cursor=!1;d._cursorPos=0;d._hasFocus=!1;d._selection=[0,0];d._wasOver=!1;d._renderOnReturn=void 0!==a.renderOnReturn?a.renderOnReturn:!0;d._disableBlur=a.disableBlur||!1;d._tabToClear=a.tabToClear||!1;d.boxShadow(d._boxShadow,!0);d._calcWH();d._renderCanvas=document.createElement("canvas");d._renderCanvas.setAttribute("width",
d.outerW);d._renderCanvas.setAttribute("height",d.outerH);d._renderCtx=d._renderCanvas.getContext("2d");d._shadowCanvas=document.createElement("canvas");d._shadowCanvas.setAttribute("width",d._width+2*d._padding);d._shadowCanvas.setAttribute("height",d._height+2*d._padding);d._shadowCtx=d._shadowCanvas.getContext("2d");"undefined"!==typeof a.backgroundGradient?(d._backgroundColor=d._renderCtx.createLinearGradient(0,0,0,d.outerH),d._backgroundColor.addColorStop(0,a.backgroundGradient[0]),d._backgroundColor.addColorStop(1,
a.backgroundGradient[1])):d._backgroundColor=a.backgroundColor||"#fff";d._canvas&&(d.mousemoveCanvasListener=function(a){a=a||window.event;d.mousemove(a,d)},d._canvas.addEventListener("mousemove",d.mousemoveCanvasListener,!1),d.mousedownCanvasListener=function(a){a=a||window.event;d.mousedown(a,d)},d._canvas.addEventListener("mousedown",d.mousedownCanvasListener,!1),d.mouseupCanvasListener=function(a){a=a||window.event;d.mouseup(a,d)},d._canvas.addEventListener("mouseup",d.mouseupCanvasListener,!1));
d.mouseupWindowListener=function(a){d._hasFocus&&!d._mouseDown&&d.blur()};window.addEventListener("mouseup",d.mouseupWindowListener,!0);d.keydownWindowListener=function(a){a=a||window.event;d._hasFocus&&d.keydown(a,d)};window.addEventListener("keydown",d.keydownWindowListener,!1);d.keyupWindowListener=function(a){a=a||window.event;d._hasFocus&&d._onkeyup(a,d)};window.addEventListener("keyup",d.keyupWindowListener,!1);d.pasteWindowListener=function(a){a=a||window.event;if(d._hasFocus){a=a.clipboardData.getData("text/plain");
var e=d._value.substr(0,d._cursorPos),f=d._value.substr(d._cursorPos);d._value=e+a+f;d._cursorPos+=a.length;d.render()}};window.addEventListener("paste",d.pasteWindowListener,!1);e.push(d);d._inputsIndex=e.length-1;d.render()}).prototype={canvas:function(a){return"undefined"!==typeof a?(this._canvas=a,this._ctx=this._canvas.getContext("2d"),this.render()):this._canvas},x:function(a){return"undefined"!==typeof a?(this._x=a,this.render()):this._x},y:function(a){return"undefined"!==typeof a?(this._y=
a,this.render()):this._y},extraX:function(a){return"undefined"!==typeof a?(this._extraX=a,this.render()):this._extraX},extraY:function(a){return"undefined"!==typeof a?(this._extraY=a,this.render()):this._extraY},fontSize:function(a){return"undefined"!==typeof a?(this._fontSize=a,this.render()):this._fontSize},fontFamily:function(a){return"undefined"!==typeof a?(this._fontFamily=a,this.render()):this._fontFamily},fontColor:function(a){return"undefined"!==typeof a?(this._fontColor=a,this.render()):
this._fontColor},placeHolderColor:function(a){return"undefined"!==typeof a?(this._placeHolderColor=a,this.render()):this._placeHolderColor},fontWeight:function(a){return"undefined"!==typeof a?(this._fontWeight=a,this.render()):this._fontWeight},fontStyle:function(a){return"undefined"!==typeof a?(this._fontStyle=a,this.render()):this._fontStyle},width:function(a){return"undefined"!==typeof a?(this._width=a,this._calcWH(),this._updateCanvasWH(),this.render()):this._width},height:function(a){return"undefined"!==
typeof a?(this._height=a,this._calcWH(),this._updateCanvasWH(),this.render()):this._height},padding:function(a){return"undefined"!==typeof a?(this._padding=a,this._calcWH(),this._updateCanvasWH(),this.render()):this._padding},borderWidth:function(a){return"undefined"!==typeof a?(this._borderWidth=a,this._calcWH(),this._updateCanvasWH(),this.render()):this._borderWidth},borderColor:function(a){return"undefined"!==typeof a?(this._borderColor=a,this.render()):this._borderColor},borderRadius:function(a){return"undefined"!==
typeof a?(this._borderRadius=a,this.render()):this._borderRadius},backgroundColor:function(a){return"undefined"!==typeof a?(this._backgroundColor=a,this.render()):this._backgroundColor},backgroundGradient:function(a){return"undefined"!==typeof a?(this._backgroundColor=this._renderCtx.createLinearGradient(0,0,0,this.outerH),this._backgroundColor.addColorStop(0,a[0]),this._backgroundColor.addColorStop(1,a[1]),this.render()):this._backgroundColor},boxShadow:function(a,d){if("undefined"!==typeof a){var e=
a.split("px ");this._boxShadow={x:"none"===this._boxShadow?0:parseInt(e[0],10),y:"none"===this._boxShadow?0:parseInt(e[1],10),blur:"none"===this._boxShadow?0:parseInt(e[2],10),color:"none"===this._boxShadow?"":e[3]};this.shadowL=0>this._boxShadow.x?Math.abs(this._boxShadow.x)+this._boxShadow.blur:Math.abs(this._boxShadow.blur-this._boxShadow.x);this.shadowR=this._boxShadow.blur+this._boxShadow.x;this.shadowT=0>this._boxShadow.y?Math.abs(this._boxShadow.y)+this._boxShadow.blur:Math.abs(this._boxShadow.blur-
this._boxShadow.y);this.shadowB=this._boxShadow.blur+this._boxShadow.y;this.shadowW=this.shadowL+this.shadowR;this.shadowH=this.shadowT+this.shadowB;this._calcWH();if(!d)return this._updateCanvasWH(),this.render()}else return this._boxShadow},innerShadow:function(a){return"undefined"!==typeof a?(this._innerShadow=a,this.render()):this._innerShadow},selectionColor:function(a){return"undefined"!==typeof a?(this._selectionColor=a,this.render()):this._selectionColor},placeHolder:function(a){return"undefined"!==
typeof a?(this._placeHolder=a,this.render()):this._placeHolder},value:function(a){return"undefined"!==typeof a?(this._value=a,this.focus()):this._value},onsubmit:function(a){if("undefined"!==typeof a)return this._onsubmit=a,this;this._onsubmit()},onkeydown:function(a){if("undefined"!==typeof a)return this._onkeydown=a,this;this._onkeydown()},onkeyup:function(a){if("undefined"!==typeof a)return this._onkeyup=a,this;this._onkeyup()},focus:function(a){var d=this,e;if(!d._readonly){d._hasFocus||d._onfocus(d);
d._selectionUpdated?delete d._selectionUpdated:d._selection=[0,0];d._cursorPos="number"===typeof a?a:d._clipText().length;d._placeHolder===d._value&&(d._value="");d._hasFocus=!0;d._cursor=!0;d._cursorInterval&&clearInterval(d._cursorInterval);d._cursorInterval=setInterval(function(){d._cursor=!d._cursor;d.render()},500);a=navigator.userAgent.toLowerCase();a=0<=a.indexOf("chrome")&&0<=a.indexOf("mobile")&&0<=a.indexOf("android");var p="undefined"!==typeof window.orientation;p&&!a&&document&&document.createElement&&
(e=document.createElement("input"))?(e.type="text",e.style.opacity=0,e.style.position="absolute",e.style.left=d._x+d._extraX+(d._canvas?d._canvas.offsetLeft:0)+"px",e.style.top=d._y+d._extraY+(d._canvas?d._canvas.offsetTop:0)+"px",e.style.width=d._width,e.style.height=0,document.body.appendChild(e),e.focus(),e.addEventListener("blur",function(){d.blur(d)},!1)):p&&d.value(prompt(d._placeHolder)||"");return d.render()}},blur:function(a){a=a||this;a._disableBlur||(a._onblur(a),a._cursorInterval&&clearInterval(a._cursorInterval),
a._hasFocus=!1,a._cursor=!1,a._selection=[0,0],""===a._value&&(a._value=a._placeHolder));return a.render()},disableBlur:function(a){(a||this)._disableBlur=!0},enableBlur:function(a){(a||this)._disableBlur=!1},keydown:function(a,d){var w=a.which,p=a.shiftKey,f=null,l;if(d._hasFocus){d._onkeydown(a,d);if(65===w&&(a.ctrlKey||a.metaKey))return d._selection=[0,d._value.length],a.preventDefault(),d.render();if(17===w||a.metaKey||a.ctrlKey)return d;a.preventDefault();if(8===w)!d._clearSelection()&&0<d._cursorPos&&
(p=d._value.substr(0,d._cursorPos-1),l=d._value.substr(d._cursorPos,d._value.length),d._value=p+l,d._cursorPos--);else if(37===w)0<d._cursorPos&&(d._cursorPos--,d._cursor=!0,d._selection=[0,0]);else if(39===w)d._cursorPos<d._value.length&&(d._cursorPos++,d._cursor=!0,d._selection=[0,0]);else if(13===w)d._onsubmit(a,d);else if(9===w)if(d._tabToClear)d._value="",d._cursorPos=0;else{var g=e[d._inputsIndex+1]?d._inputsIndex+1:0;g!==d._inputsIndex&&(d.blur(),setTimeout(function(){e[g].focus()},10))}else if(f=
d._mapCodeToKey(p,w)){d._clearSelection();if(d._maxlength&&d._maxlength<=d._value.length)return;p=d._value?d._value.substr(0,d._cursorPos):"";l=d._value?d._value.substr(d._cursorPos):"";d._value=p+f+l;d._cursorPos++}return 13==w&&d._renderOnReturn||13!==w?d.render():function(){}}},click:function(a,d){var e=d._mousePos(a),p=e.x,e=e.y;if(d._endSelection)delete d._endSelection,delete d._selectionUpdated;else if(d._canvas&&d._overInput(p,e)||!d._canvas){if(d._mouseDown)return d._mouseDown=!1,d.click(a,
d),d.focus(d._clickPos(p,e))}else return d.blur()},mousemove:function(a,d){var e=d._mousePos(a),p=e.x,f=e.y;(e=d._overInput(p,f))&&d._canvas?(d._canvas.style.cursor="text",d._wasOver=!0):d._wasOver&&d._canvas&&(d._canvas.style.cursor="default",d._wasOver=!1);if(d._hasFocus&&0<=d._selectionStart)if(f=d._clickPos(p,f),p=Math.min(d._selectionStart,f),f=Math.max(d._selectionStart,f),!e)d._selectionUpdated=!0,d._endSelection=!0,delete d._selectionStart,d.render();else if(d._selection[0]!==p||d._selection[1]!==
f)d._selection=[p,f],d.render()},mousedown:function(a,d){var e=d._mousePos(a),p=e.x,e=e.y,f=d._overInput(p,e);d._mouseDown=f;d._hasFocus&&f&&(d._selectionStart=d._clickPos(p,e))},mouseup:function(a,d){var e=d._mousePos(a),p=e.x,e=e.y,f=d._clickPos(p,e)!==d._selectionStart;d._hasFocus&&0<=d._selectionStart&&d._overInput(p,e)&&f?(d._selectionUpdated=!0,delete d._selectionStart,d.render()):delete d._selectionStart;d.click(a,d)},renderCanvas:function(){return this._renderCanvas},cleanup:function(){this._canvas.removeEventListener("mouseup",
this.mouseupCanvasListener,!1);this._canvas.removeEventListener("mousedown",this.mousedownCanvasListener,!1);this._canvas.removeEventListener("mousemove",this.mousemoveCanvasListener,!1);window.removeEventListener("keydown",this.keydownWindowListener,!1);window.removeEventListener("keyup",this.keyupWindowListener,!1);window.removeEventListener("mouseup",this.mouseupWindowListener,!0);window.removeEventListener("paste",this.pasteWindowListener,!1);clearInterval(this._cursorInterval);this._canvas.style.cursor=
"default";for(var a=0;a<e.length;a++)e[a]===this&&e.remove(a)},render:function(){var a=this,d=a._renderCtx,e=a.outerW,p=a.outerH,f=a._borderRadius,l=a._borderWidth,g=a.shadowW,k=a.shadowH;d.clearRect(0,0,d.canvas.width,d.canvas.height);d.shadowOffsetX=a._boxShadow.x;d.shadowOffsetY=a._boxShadow.y;d.shadowBlur=a._boxShadow.blur;d.shadowColor=a._boxShadow.color;0<a._borderWidth&&(d.fillStyle=a._borderColor,a._roundedRect(d,a.shadowL,a.shadowT,e-g,p-k,f),d.fill(),d.shadowOffsetX=0,d.shadowOffsetY=0,
d.shadowBlur=0);a._drawTextBox(function(){d.shadowOffsetX=0;d.shadowOffsetY=0;d.shadowBlur=0;var h=a._clipText(),B=a._padding+a._borderWidth+a.shadowT;if(0<a._selection[1]){var t=a._textWidth(h.substring(0,a._selection[0])),u=a._textWidth(h.substring(a._selection[0],a._selection[1]));d.fillStyle=a._selectionColor;d.fillRect(B+t,B,u,a._height)}d.fillStyle=a._placeHolder===a._value&&""!==a._value?a._placeHolderColor:a._fontColor;a._cursor&&(t=a._textWidth(h.substring(0,a._cursorPos)),d.fillRect(B+t,
B,1,a._height));t=a._padding+a._borderWidth+a.shadowL;B=Math.round(B+a._height/2);d.font=a._fontStyle+" "+a._fontWeight+" "+a._fontSize+"px "+a._fontFamily;d.textAlign="left";d.textBaseline="middle";d.fillText(h,t,B);u=a._innerShadow.split("px ");h="none"===a._innerShadow?0:parseInt(u[0],10);B="none"===a._innerShadow?0:parseInt(u[1],10);t="none"===a._innerShadow?0:parseInt(u[2],10);u="none"===a._innerShadow?"":u[3];if(0<t){var z=a._shadowCtx,A=z.canvas.width,E=z.canvas.height;z.clearRect(0,0,A,E);
z.shadowBlur=t;z.shadowColor=u;z.shadowOffsetX=0;z.shadowOffsetY=B;z.fillRect(-1*e,-100,3*e,100);z.shadowOffsetX=h;z.shadowOffsetY=0;z.fillRect(A,-1*p,100,3*p);z.shadowOffsetX=0;z.shadowOffsetY=B;z.fillRect(-1*e,E,3*e,100);z.shadowOffsetX=h;z.shadowOffsetY=0;z.fillRect(-100,-1*p,100,3*p);a._roundedRect(d,l+a.shadowL,l+a.shadowT,e-2*l-g,p-2*l-k,f);d.clip();d.drawImage(a._shadowCanvas,0,0,A,E,l+a.shadowL,l+a.shadowT,A,E)}a._ctx&&(a._ctx.clearRect(a._x,a._y,d.canvas.width,d.canvas.height),a._ctx.drawImage(a._renderCanvas,
a._x,a._y));return a})},_drawTextBox:function(a){var d=this,e=d._renderCtx,p=d.outerW,f=d.outerH,l=d._borderRadius,g=d._borderWidth,k=d.shadowW,h=d.shadowH;if(""===d._backgroundImage)e.fillStyle=d._backgroundColor,d._roundedRect(e,g+d.shadowL,g+d.shadowT,p-2*g-k,f-2*g-h,l),e.fill(),a();else{var B=new Image;B.src=d._backgroundImage;B.onload=function(){e.drawImage(B,0,0,B.width,B.height,g+d.shadowL,g+d.shadowT,p,f);a()}}},_clearSelection:function(){if(0<this._selection[1]){var a=this._selection[0],
d=this._selection[1];this._value=this._value.substr(0,a)+this._value.substr(d);this._cursorPos=a;this._cursorPos=0>this._cursorPos?0:this._cursorPos;this._selection=[0,0];return!0}return!1},_clipText:function(a){a="undefined"===typeof a?this._value:a;var d=this._textWidth(a)/(this._width-this._padding);return(1<d?a.substr(-1*Math.floor(a.length/d)):a)+""},_textWidth:function(a){var d=this._renderCtx;d.font=this._fontStyle+" "+this._fontWeight+" "+this._fontSize+"px "+this._fontFamily;d.textAlign=
"left";return d.measureText(a).width},_calcWH:function(){this.outerW=this._width+2*this._padding+2*this._borderWidth+this.shadowW;this.outerH=this._height+2*this._padding+2*this._borderWidth+this.shadowH},_updateCanvasWH:function(){var a=this._renderCanvas.width,d=this._renderCanvas.height;this._renderCanvas.setAttribute("width",this.outerW);this._renderCanvas.setAttribute("height",this.outerH);this._shadowCanvas.setAttribute("width",this._width+2*this._padding);this._shadowCanvas.setAttribute("height",
this._height+2*this._padding);this._ctx&&this._ctx.clearRect(this._x,this._y,a,d)},_roundedRect:function(a,d,e,p,f,l){p<2*l&&(l=p/2);f<2*l&&(l=f/2);a.beginPath();a.moveTo(d+l,e);a.lineTo(d+p-l,e);a.quadraticCurveTo(d+p,e,d+p,e+l);a.lineTo(d+p,e+f-l);a.quadraticCurveTo(d+p,e+f,d+p-l,e+f);a.lineTo(d+l,e+f);a.quadraticCurveTo(d,e+f,d,e+f-l);a.lineTo(d,e+l);a.quadraticCurveTo(d,e,d+l,e);a.closePath()},_overInput:function(a,d){var e=a<=this._x+this._extraX+this._width+2*this._padding,p=d>=this._y+this._extraY,
f=d<=this._y+this._extraY+this._height+2*this._padding;return a>=this._x+this._extraX&&e&&p&&f},_clickPos:function(a,d){var e=this._value;this._value===this._placeHolder&&(e="");var e=this._clipText(e),p=0,f=e.length;if(a-(this._x+this._extraX)<this._textWidth(e))for(var l=0;l<e.length;l++)if(p+=this._textWidth(e[l]),p>=a-(this._x+this._extraX)){f=l;break}return f},_mousePos:function(a){var d=a.target,e=document.defaultView.getComputedStyle(d,void 0),p=parseInt(e.paddingLeft,10)||0,f=parseInt(e.paddingLeft,
10)||0,l=parseInt(e.borderLeftWidth,10)||0,e=parseInt(e.borderLeftWidth,10)||0,g=document.body.parentNode.offsetTop||0,k=document.body.parentNode.offsetLeft||0,h=0,B=0;if("unefined"!==typeof d.offsetParent){do h+=d.offsetLeft,B+=d.offsetTop;while(d=d.offsetParent)}return{x:a.pageX-(h+(p+l+k)),y:a.pageY-(B+(f+e+g))}},_mapCodeToKey:function(a,d){for(var e=[8,9,13,16,17,18,20,27,91,92],p="",p=0;p<e.length;p++)if(d===e[p])return;if("boolean"===typeof a&&"number"===typeof d)return e={32:" ",48:")",49:"!",
50:"@",51:"#",52:"$",53:"%",54:"^",55:"&",56:"*",57:"(",59:":",107:"+",189:"_",186:":",187:"+",188:"<",190:">",191:"?",192:"~",219:"{",220:"|",221:"}",222:'"'},p=a?65<=d&&90>=d?String.fromCharCode(d):e[d]:65<=d&&90>=d?String.fromCharCode(d).toLowerCase():96===d?"0":97===d?"1":98===d?"2":99===d?"3":100===d?"4":101===d?"5":102===d?"6":103===d?"7":104===d?"8":105===d?"9":188===d?",":190===d?".":191===d?"/":192===d?"`":220===d?"\\":187===d?"=":189===d?"-":222===d?"'":186===d?";":219===d?"[":221===d?"]":
String.fromCharCode(d)}}})();
(function(e,a){e.Spinner=a()})(this,function(){function e(a,d){var e=document.createElement(a||"div"),f;for(f in d)e[f]=d[f];return e}function a(a){for(var d=1,e=arguments.length;d<e;d++)a.appendChild(arguments[d]);return a}function d(a,d,e,f){var g=["opacity",d,~~(100*a),e,f].join("-");e=0.01+e/f*100;f=Math.max(1-(1-a)/d*(100-e),a);var l=u.substring(0,u.indexOf("Animation")).toLowerCase();t[g]||(z.insertRule("@"+(l&&"-"+l+"-"||"")+"keyframes "+g+"{0%{opacity:"+f+"}"+e+"%{opacity:"+a+"}"+(e+0.01)+
"%{opacity:1}"+(e+d)%100+"%{opacity:"+a+"}100%{opacity:"+f+"}}",z.cssRules.length),t[g]=1);return g}function w(a,d){var e=a.style,f,g;d=d.charAt(0).toUpperCase()+d.slice(1);for(g=0;g<B.length;g++)if(f=B[g]+d,void 0!==e[f])return f;if(void 0!==e[d])return d}function p(a,d){for(var e in d)a.style[w(a,e)||e]=d[e];return a}function f(a){for(var d=1;d<arguments.length;d++){var e=arguments[d],f;for(f in e)void 0===a[f]&&(a[f]=e[f])}return a}function l(a){for(var d={x:a.offsetLeft,y:a.offsetTop};a=a.offsetParent;)d.x+=
a.offsetLeft,d.y+=a.offsetTop;return d}function g(a,d){return"string"==typeof a?a:a[d%a.length]}function k(a){if("undefined"==typeof this)return new k(a);this.opts=f(a||{},k.defaults,A)}function h(){function d(a,f){return e("<"+a+' xmlns="urn:schemas-microsoft.com:vml" class="spin-vml">',f)}z.addRule(".spin-vml","behavior:url(#default#VML)");k.prototype.lines=function(e,f){function l(){return p(d("group",{coordsize:B+" "+B,coordorigin:-h+" "+-h}),{width:B,height:B})}function k(c,e,M){a(v,a(p(l(),
{rotation:360/f.lines*c+"deg",left:~~e}),a(p(d("roundrect",{arcsize:f.corners}),{width:h,height:f.width,left:f.radius,top:-f.width>>1,filter:M}),d("fill",{color:g(f.color,c),opacity:f.opacity}),d("stroke",{opacity:0}))))}var h=f.length+f.width,B=2*h,c=2*-(f.width+f.length)+"px",v=p(l(),{position:"absolute",top:c,left:c});if(f.shadow)for(c=1;c<=f.lines;c++)k(c,-2,"progid:DXImageTransform.Microsoft.Blur(pixelradius=2,makeshadow=1,shadowopacity=.3)");for(c=1;c<=f.lines;c++)k(c);return a(e,v)};k.prototype.opacity=
function(a,d,e,f){a=a.firstChild;f=f.shadow&&f.lines||0;a&&d+f<a.childNodes.length&&(a=(a=(a=a.childNodes[d+f])&&a.firstChild)&&a.firstChild)&&(a.opacity=e)}}var B=["webkit","Moz","ms","O"],t={},u,z=function(){var d=e("style",{type:"text/css"});a(document.getElementsByTagName("head")[0],d);return d.sheet||d.styleSheet}(),A={lines:12,length:7,width:5,radius:10,rotate:0,corners:1,color:"#000",direction:1,speed:1,trail:100,opacity:0.25,fps:20,zIndex:2E9,className:"spinner",top:"auto",left:"auto",position:"relative"};
k.defaults={};f(k.prototype,{spin:function(a){this.stop();var d=this,f=d.opts,g=d.el=p(e(0,{className:f.className}),{position:f.position,width:0,zIndex:f.zIndex}),k=f.radius+f.length+f.width,h,B;a&&(a.insertBefore(g,a.firstChild||null),B=l(a),h=l(g),p(g,{left:("auto"==f.left?B.x-h.x+(a.offsetWidth>>1):parseInt(f.left,10)+k)+"px",top:("auto"==f.top?B.y-h.y+(a.offsetHeight>>1):parseInt(f.top,10)+k)+"px"}));g.setAttribute("role","progressbar");d.lines(g,d.opts);if(!u){var c=0,v=(f.lines-1)*(1-f.direction)/
2,y,G=f.fps,M=G/f.speed,n=(1-f.opacity)/(M*f.trail/100),Z=M/f.lines;(function x(){c++;for(var a=0;a<f.lines;a++)y=Math.max(1-(c+(f.lines-a)*Z)%M*n,f.opacity),d.opacity(g,a*f.direction+v,y,f);d.timeout=d.el&&setTimeout(x,~~(1E3/G))})()}return d},stop:function(){var a=this.el;a&&(clearTimeout(this.timeout),a.parentNode&&a.parentNode.removeChild(a),this.el=void 0);return this},lines:function(f,l){function k(a,c){return p(e(),{position:"absolute",width:l.length+l.width+"px",height:l.width+"px",background:a,
boxShadow:c,transformOrigin:"left",transform:"rotate("+~~(360/l.lines*h+l.rotate)+"deg) translate("+l.radius+"px,0)",borderRadius:(l.corners*l.width>>1)+"px"})}for(var h=0,B=(l.lines-1)*(1-l.direction)/2,t;h<l.lines;h++)t=p(e(),{position:"absolute",top:1+~(l.width/2)+"px",transform:l.hwaccel?"translate3d(0,0,0)":"",opacity:l.opacity,animation:u&&d(l.opacity,l.trail,B+h*l.direction,l.lines)+" "+1/l.speed+"s linear infinite"}),l.shadow&&a(t,p(k("#000","0 0 4px #000"),{top:"2px"})),a(f,a(t,k(g(l.color,
h),"0 0 1px rgba(0,0,0,.1)")));return f},opacity:function(a,d,e){d<a.childNodes.length&&(a.childNodes[d].style.opacity=e)}});var E=p(e("group"),{behavior:"url(#default#VML)"});!w(E,"transform")&&E.adj?h():u=w(E,"animation");return k});window.m=window.m||{};
(function(e,a){var d="undefined";(function(a){e.log=a()})(function(){function e(d,f){var g=d[f];if(g.bind===a){if(Function.prototype.bind===a)return p(g,d);try{return Function.prototype.bind.call(d[f],d)}catch(l){return p(g,d)}}else return d[f].bind(d)}function p(a,d){return function(){Function.prototype.apply.apply(a,[d,arguments])}}function f(a){for(var d=0;d<t.length;d++)h[t[d]]=a(t[d])}function l(){return typeof window!==d&&window.document!==a&&window.document.cookie!==a}function g(){try{return typeof window!==
d&&window.localStorage!==a}catch(e){return!1}}function k(a){var d=!1,e,f;for(f in h.levels)if(h.levels.hasOwnProperty(f)&&h.levels[f]===a){e=f;break}if(g())try{window.localStorage.mloglevel=e}catch(k){d=!0}else d=!0;d&&l()&&(window.document.cookie="mloglevel="+e+";")}var h={},B=function(){},t=["trace","debug","info","warn","error"],u=/mloglevel=([^;]+)/;h.levels={TRACE:0,DEBUG:1,INFO:2,WARN:3,ERROR:4,SILENT:5};h.setLevel=function(g){if("number"===typeof g&&0<=g&&g<=h.levels.SILENT)if(k(g),g===h.levels.SILENT)f(function(){return B});
else{if(typeof console===d)return f(function(a){return function(){typeof console!==d&&(h.setLevel(g),h[a].apply(h,arguments))}}),"No console available for logging";f(function(f){return g<=h.levels[f.toUpperCase()]?typeof console===d?B:console[f]===a?console.log!==a?e(console,"log"):B:e(console,f):B})}else if("string"===typeof g&&h.levels[g.toUpperCase()]!==a)h.setLevel(h.levels[g.toUpperCase()]);else throw"log.setLevel() called with invalid level: "+g;};h.enableAll=function(){h.setLevel(h.levels.TRACE)};
h.disableAll=function(){h.setLevel(h.levels.SILENT)};(function(){var d;g()&&(d=window.localStorage.mloglevel);d===a&&l()&&(d=(u.exec(window.document.cookie)||[])[1]);h.levels[d]===a&&(d="WARN");h.setLevel(h.levels[d])})();return h})})(window.m);window.m=window.m||{};
(function(e,a){function d(a){return(10>a?"0":"")+a}var w={0:["None","U"],1:["Time","sec"],2:["Delay","sec"],3:["Frequency","Hz"],4:["Time code format",""],5:["Distance","m"],6:["Speed","m/s"],7:["Acceleration","m/sec^2"],8:["Jerk","m/sec^3"],9:["Doppler","Hz"],10:["Doppler rate","Hz/sec"],11:["Energy","J"],12:["Power","W"],13:["Mass","g"],14:["Volume","l"],15:["Angular power density","W/ster"],16:["Integrated power density","W/rad"],17:["Spatial power density","W/m^2"],18:["Integrated power density",
"W/m"],19:["Spectral power density","W/MHz"],20:["Amplitude","U"],21:["Real","U"],22:["Imaginary","U"],23:["Phase","rad"],24:["Phase","deg"],25:["Phase","cycles"],26:["10*Log","U"],27:["20*Log","U"],28:["Magnitude","U"],29:["Unknown","U"],30:["Unknown","U"],31:["General dimensionless",""],32:["Counts",""],33:["Angle","rad"],34:["Angle","deg"],35:["Relative power","dB"],36:["Relative power","dBm"],37:["Relative power","dBW"],38:["Solid angle","ster"],40:["Distance","ft"],41:["Distance","nmi"],42:["Speed",
"ft/sec"],43:["Speed","nmi/sec"],44:["Speed","knots=nmi/hr"],45:["Acceleration","ft/sec^2"],46:["Acceleration","nmi/sec^2"],47:["Acceleration","knots/sec"],48:["Acceleration","G"],49:["Jerk","G/sec"],50:["Rotation","rps"],51:["Rotation","rpm"],52:["Angular velocity","rad/sec"],53:["Angular velocity","deg/sec"],54:["Angular acceleration","rad/sec^2"],55:["Angular acceleration","deg/sec^2"],60:["Latitude","deg"],61:["Longitude","deg"],62:["Altitude","ft"],63:["Altitude","m"]};e.Mc={colormap:[{name:"Greyscale",
colors:[{pos:0,red:0,green:0,blue:0},{pos:60,red:50,green:50,blue:50},{pos:100,red:100,green:100,blue:100},{pos:100,red:0,green:0,blue:0},{pos:100,red:0,green:0,blue:0},{pos:100,red:0,green:0,blue:0},{pos:100,red:0,green:0,blue:0}]},{name:"Ramp Colormap",colors:[{pos:0,red:0,green:0,blue:15},{pos:10,red:0,green:0,blue:50},{pos:31,red:0,green:65,blue:75},{pos:50,red:0,green:85,blue:0},{pos:70,red:75,green:80,blue:0},{pos:83,red:100,green:60,blue:0},{pos:100,red:100,green:0,blue:0}]},{name:"Color Wheel",
colors:[{pos:0,red:100,green:100,blue:0},{pos:20,red:0,green:80,blue:40},{pos:30,red:0,green:100,blue:100},{pos:50,red:10,green:10,blue:0},{pos:65,red:100,green:0,blue:0},{pos:88,red:100,green:40,blue:0},{pos:100,red:100,green:100,blue:0}]},{name:"Spectrum",colors:[{pos:0,red:0,green:75,blue:0},{pos:22,red:0,green:90,blue:90},{pos:37,red:0,green:0,blue:85},{pos:49,red:90,green:0,blue:85},{pos:68,red:90,green:0,blue:0},{pos:80,red:90,green:90,blue:0},{pos:100,red:95,green:95,blue:95}]},{name:"Sunset",
colors:[{pos:0,red:10,green:0,blue:23},{pos:18,red:34,green:0,blue:60},{pos:36,red:58,green:20,blue:47},{pos:55,red:74,green:20,blue:28},{pos:72,red:90,green:43,blue:0},{pos:87,red:100,green:72,blue:0},{pos:100,red:100,green:100,blue:76}]}]};e.PIPESIZE=1048576;e.initialize=function(d,l){var g=new BlueHeader(null);g.version="BLUE";g.size=0;g.type=1E3;g.format="SF";g.timecode=0;g.xstart=0;g.xdelta=1;g.xunits=0;g.subsize=1;g.ystart=0;g.ydelta=1;g.yunits=0;l||(l={});for(var k in l)g[k]=l[k];1<g.subsize&&
(g.type=2E3);g["class"]=g.type/1E3;if(2===g["class"]&&l.subsize===a)throw"subsize must be provided with type 2000 files";l.pipe?(g.pipe=!0,g.in_byte=0,g.out_byte=0,g.buf=new ArrayBuffer(l.pipesize||e.PIPESIZE),g.setData(g.buf),g.data_free=g.dview.length):g.setData(d);return g};e.force1000=function(a){2===a["class"]&&(a.size=a.size&&!a.pipe?a.subsize*a.size:0,a.bpe/=a.subsize,a.ape=1)};e.grab=function(d,e,g,k){if(!d.dview)return 0;"C"===d.format[0]&&(g*=2);k=Math.min(e.length,d.dview.length-g);if(e.set===
a)for(var h=0;h<k;h++)e[h]=d.dview[g+h];else e.set(d.dview.subarray(g,g+k));"C"===d.format[0]&&(k/=2);return k};e.filad=function(a,d,e){if(a.data_free<d.length)throw"Pipe full";var k=a.in_byte/a.dview.BYTES_PER_ELEMENT,h=k+d.length;if(h>a.dview.length){var h=a.dview.length-k,p=d.length-h;d.subarray?(a.dview.set(d.subarray(0,h),k),a.dview.set(d.subarray(h,d.length),0)):(a.dview.set(d.slice(0,h),k),a.dview.set(d.slice(h,d.length),0));a.in_byte=p*a.dview.BYTES_PER_ELEMENT}else a.dview.set(d,k),a.in_byte=
h*a.dview.BYTES_PER_ELEMENT%a.buf.byteLength;a.data_free-=d.length;if(a.onwritelisteners)for(d=0;d<a.onwritelisteners.length;d++)if(e)a.onwritelisteners[d]();else window.setTimeout(a.onwritelisteners[d],0)};e.pavail=function(a){return a.dview.length-a.data_free};e.grabx=function(d,e,g,k){var h=d.dview.length-d.data_free;k===a&&(k=0);if(!g)g=Math.min(e.length-k,h);else if(g>e.length-k)throw"m.grabx : nget larger then available buffer space";if(0>g)throw"m.grabx : nget cannot be negative";if(g>h)return 0;
var h=d.out_byte/d.dview.BYTES_PER_ELEMENT,p=h+g;if(p>=d.dview.length){var t=d.dview.length-h,p=p-d.dview.length;e.set(d.dview.subarray(h,d.dview.length),k);e.set(d.dview.subarray(0,p),k+t)}else e.set(d.dview.subarray(h,p),k);d.out_byte=p*d.dview.BYTES_PER_ELEMENT%d.buf.byteLength;d.data_free+=g;return g};e.addPipeWriteListener=function(a,d){a.onwritelisteners||(a.onwritelisteners=[]);-1===a.onwritelisteners.indexOf(d)&&a.onwritelisteners.push(d)};e.units_name=function(a){a=w[a];return a[0]+" ("+
a[1]+")"};e.trim_name=function(a){var d=a.indexOf("]");-1===d&&(d=a.indexOf("/"));-1===d&&(d=a.indexOf(":"));var e=a.substr(d+1,a.length).indexOf(".");0>e&&(e=a.length-d);return a.substr(d+1,d+e+1)};e.label=function(d,e){var g=["Unknown","U"];"string"===typeof d?g=[d,null]:Array.isArray(d)?g=d:(g=w[d],g===a&&(g=["Unknown","U"]));var k="?";1==e?k="":10==e?k="da":0.1==e?k="d":100==e?k="h":0.01==e?k="c":1E3==e?k="K":0.001==e?k="m":1E6==e?k="M":1E-6==e?k="u":1E9==e?k="G":1E-9==e?k="n":1E12==e?k="T":1E-12==
e&&(k="p");return g[1]?g[0]+" ("+k+g[1]+")":g[0]};var p="F";e.vstype=function(a){p=a;"D"===p||"L"===p||"F"===p||"I"===p||"B"===p||alert("Unsupported vector type")};e.vlog10=function(d,e,g){e===a&&(e=1E-20);g===a&&(g=d);for(var k=0;k<d.length&&!(g.length<=k);k++)g[k]=Math.log(Math.max(d[k],e))/Math.log(10)};e.vlogscale=function(d,e,g,k){e===a&&(e=1E-20);g===a&&(g=1);k===a&&(k=d);for(var h=0;h<d.length&&!(k.length<=h);h++)k[h]=Math.log(Math.abs(Math.max(d[h],e)))/Math.log(10),k[h]*=g};e.cvmag2logscale=
function(d,e,g,k){e===a&&(e=1E-20);g===a&&(g=1);k===a&&(k=d);for(var h=0,p=0;p<k.length;p++){h=2*p+1;if(h>=d.length)break;k[p]=d[h-1]*d[h-1]+d[h]*d[h];k[p]=Math.log(Math.abs(Math.max(k[p],e)))/Math.log(10);k[p]*=g}};e.vsmul=function(d,e,g,k){g===a&&(g=d);k===a&&(k=g.length);k=Math.min(g.length,k);k=Math.min(d.length,k);for(var h=0;h<k&&!(g.length<=h);h++)g[h]=d[h]*e};e.vmxmn=function(a,d){var e=a[0],k=a[0],h=0,p=0;d=Math.min(d,a.length);for(var t=0;t<d;t++)a[t]>e&&(e=a[t],h=t),a[t]<k&&(k=a[t],p=t);
return{smax:e,smin:k,imax:h,imin:p}};e.vmov=function(d,e,g,k,h){h===a&&(h=d.length);h=Math.min(d.length,h);for(var p=0;p<h;p++){var t=p*e,u=p*k;if(t>=d.length)break;if(u>=g.length)break;g[u]=d[t]}};e.vfill=function(d,e,g){g===a&&(g=d.length);g=Math.min(d.length,g);for(var k=0;k<g;k++)d[k]=e};e.vabs=function(d,e,g){g===a&&(g=d.length);e===a&&(e=d);for(var k=0;k<g;k++)e[k]=Math.abs(d[k])};e.cvmag=function(d,e,g){g===a&&(g=e.length);g=Math.min(e.length,g);for(var k=0;k<g;k++){var h=2*k+1;if(h>=d.length)break;
e[k]=Math.sqrt(d[h-1]*d[h-1]+d[h]*d[h])}};e.cvmag2=function(d,e,g){g===a&&(g=e.length);g=Math.min(e.length,g);for(var k=0,h=0;h<g;h++){k=2*h+1;if(k>=d.length)break;e[h]=d[k-1]*d[k-1]+d[k]*d[k]}};e.cvpha=function(d,e,g){g===a&&(g=e.length);g=Math.min(e.length,g);for(var k=0,h=0,p=k=0;p<g;p++){k=2*p+1;if(k>=d.length)break;h=d[k-1];k=d[k];0===h&&0===k&&(h=1);e[p]=Math.atan2(k,h)}};e.cvphad=function(d,e,g){g===a&&(g=e.length);g=Math.min(e.length,g);for(var k=0,h=0,p=k=0;p<g;p++){k=2*p+1;if(k>=d.length)break;
h=d[k-1];k=d[k];0===h&&0===k&&(h=1);e[p]=Math.atan2(k,h)*(180/Math.PI)}};e.trunc=function(a){return a-a%1};e.sign=function(a,d){return 0<=d?Math.abs(a):-Math.abs(a)};e.sec2tod=function(a,e){var g="",g=Date.UTC(1950,0,1);Date.UTC(1949,11,31);var k=new Date,k=new Date(k.getFullYear(),k.getMonth(),k.getDate(),0,0,0,0);0<=a?86400>a?(g=k.getTime()+1E3*a,k=new Date(g),g=d(k.getHours())+":"+d(k.getMinutes())+":"+d(k.getSeconds())):86400===a?g="24:00:00":31536E3>a?(g=a/86400,g=[0<g?Math.floor(g):Math.ceil(g)],
k=new Date(1E3*a+k.getTime()),g=g.toString()+"::"+d(k.getHours())+":"+d(k.getMinutes())+":"+d(k.getSeconds())):(g=Math.floor(1E3*a)+g,k=new Date(g),g=k.getUTCFullYear()+":"+d(k.getUTCMonth()+1)+":"+d(k.getUTCDate())+"::"+d(k.getUTCHours())+":"+d(k.getUTCMinutes())+":"+d(k.getUTCSeconds())):-31536E3<a?(g=a/86400,g=0>=g?Math.ceil(g):Math.floor(g),k=new Date(Math.abs(1E3*a)+k.getTime()),g=0===g?"-0":g.toString(),g=g+"::"+d(k.getHours())+":"+d(k.getMinutes())+":"+d(k.getSeconds())):(g=Math.floor(1E3*
a)+g,k=new Date(g),g=k.getUTCFullYear()+":"+d(k.getUTCMonth()+1)+":"+d(k.getUTCDate())+"::"+d(k.getUTCHours())+":"+d(k.getUTCMinutes())+":"+d(k.getUTCSeconds()));g=0===a%1?g+".000000":g+("."+Math.abs(a%1).toPrecision(6).slice(2,8));if(e){var k=g.indexOf("."),h=-1;-1!==k&&(h=g.substr(k,g.length).indexOf("0"));-1!==h&&(g=g.substr(0,k+h))}return g};e.sec2tspec=function(a,d,g){d=d||"";if(0<=a&&86400>=a)return e.sec2tod(a,g);a%=86400;return"delta"!==d&&0>=a?e.sec2tod(a+86400,g):"delta"===d&&0>=a?"-"+e.sec2tod(-1*
a,g):e.sec2tod(a,g)};e.sec2tod_j1970=function(a){var e="";0<=a&&86400>a?(e=new Date(1E3*a),e=d(e.getHours())+":"+d(e.getMinutes())+":"+d(e.getSeconds())):0>a&&-31536E3<a?(e=new Date(1E3*a),e=(a/86400*-1).toString()+"::"+d(e.getHours())+":"+d(e.getMinutes())+":"+d(e.getSeconds())):(e=new Date(1E3*(a-631152E3)),e=e.getFullYear()+":"+d(e.getMonth())+":"+d(e.getDate())+"::"+d(e.getHours())+":"+d(e.getMinutes())+":"+d(e.getSeconds()));0!==a%1&&(e+="."+(a%1).toPrecision(6).slice(2,8));return e};e.j1970toj1950=
function(d){return d.getTime!==a?d.getTime()/1E3+631152E3:d+631152E3};e.j1950toj1970=function(a){return a-631152E3};e.throttle=function(a,d){var e=(new Date).getTime();return function(){var k=(new Date).getTime();k-e>=a&&(e=k,d.apply(null,arguments))}}})(window.m);window.mx=window.mx||{};
(function(e,a,d){function w(){this.ymax=this.ymin=this.xmax=this.xmin=this.yl=this.xl=this.yo=this.xo=0;this.mode=this.func=d}function p(c){this.root=c;this.parent=document.createElement("div");this.parent.style.position="relative";this.parent.width=c.clientWidth;this.parent.height=c.clientHeight;c.appendChild(this.parent);this.canvas=document.createElement("canvas");this.canvas.style.position="absolute";this.canvas.style.top="0px";this.canvas.style.left="0px";this.canvas.width=c.clientWidth;this.canvas.height=
c.clientHeight;this.parent.appendChild(this.canvas);this.active_canvas=this.canvas;this.wid_canvas=document.createElement("canvas");this.wid_canvas.style.position="absolute";this.wid_canvas.style.top="0px";this.wid_canvas.style.left="0px";this.wid_canvas.style.zIndex=1;this.wid_canvas.width=c.clientWidth;this.wid_canvas.height=c.clientHeight;this.parent.appendChild(this.wid_canvas);this.level=this.text_h=this.text_w=0;this.width=this.parent.width;this.height=this.parent.height;this.ymrk=this.xmrk=
this.ypos=this.xpos=0;this.origin=1;this.stk=[new e.STKSTRUCT];e.setbgfg(this,"black","white");this.warpbox=this.event_cb=d;this.rmode=!1;this.linewidth=1;this.style=d;this.xi=!1;this.l=this.state_mask=this.button_press=this.button_release=0;this.r=this.width;this.t=0;this.b=this.height;this.scrollbar_x=new e.SCROLLBAR;this.scrollbar_y=new e.SCROLLBAR;this.prompt=d;this.pixel=[];this._renderCanvas=document.createElement("canvas")}function f(c,a,d,e,g,n,f){g<=d?f>d&&0<(e-a)*(f-d)-(n-a)*(g-d)&&(c+=
1):f<=d&&0>(e-a)*(f-d)-(n-a)*(g-d)&&(c-=1);return c}function l(c,a){a.animationFrameHandle||(a.animationFrameHandle=requestAnimFrame(e.withWidgetLayer(c,function(){e.erase_window(c);a.animationFrameHandle=d;var y=1.5*c.text_h;a.x=Math.max(a.x,0);a.y=Math.max(a.y,0);a.x=Math.min(a.x,c.width-a.w);a.y=Math.min(a.y,c.height-a.h);var G=a.x+F.GBorder+Math.max(0,F.sidelab),g=a.y+F.GBorder+F.toplab*(y+F.GBorder),n=a.w-2*F.GBorder-Math.abs(F.sidelab);e.widgetbox(c,a.x,a.y,a.w,a.h,G,g,n,a.h-2*F.GBorder-F.toplab*
(y+F.GBorder),a.title);var f=c.wid_canvas.getContext("2d");f.lineWidth=1;f.strokeStyle=c.xwbs;f.beginPath();f.moveTo(G,g-4+0.5);f.lineTo(G+n-1,g-4+0.5);f.stroke();f.strokeStyle=c.xwts;f.beginPath();f.moveTo(G,g-3+0.5);f.lineTo(G+n-1,g-3+0.5);f.stroke();for(var k=0;k<a.items.length;k++){var x=a.items[k],l=g+y*k;"separator"===x.style?(f.fillStyle=c.xwbs,f.fillRect(G,l,n,y),f.beginPath(),f.moveTo(G,l+0.5),f.lineTo(G+n,l+0.5),f.stroke(),f.textBaseline="middle",f.textAlign="left",f.fillStyle=c.xwfg,f.fillText(" "+
x.text+" ",G+2*c.text_w,l+y/2)):(e.LEGACY_RENDER?(f.fillStyle=c.xwlo,f.fillRect(G,l,n,y),f.beginPath(),f.moveTo(G,l+0.5),f.lineTo(G+n,l+0.5),f.stroke(),x.selected&&e.shadowbox(c,G-1,l,n+2,y,1,2,"",0.75)):(f.save(),f.globalAlpha=0.75,f.fillStyle=x.selected?c.xwts:c.xwlo,f.fillRect(G,l,n,y),f.restore(),f.strokeStyle=c.bg,f.beginPath(),f.moveTo(G,l+0.5),f.lineTo(G+n,l+0.5),f.stroke()),f.textBaseline="middle",f.textAlign="left",f.fillStyle=c.xwfg,"checkbox"===x.style?(f.fillText(" "+x.text+" ",G+2*c.text_w,
l+y/2),f.strokeStyle=c.xwfg,f.strokeRect(G+1+c.text_w,l+(y-c.text_w)/2,c.text_w,c.text_w),x.checked&&(f.beginPath(),f.moveTo(G+1+c.text_w,l+(y-c.text_w)/2),f.lineTo(G+1+c.text_w+c.text_w,l+(y-c.text_w)/2+c.text_w),f.stroke(),f.beginPath(),f.moveTo(G+1+c.text_w+c.text_w,l+(y-c.text_w)/2),f.lineTo(G+1+c.text_w,l+(y-c.text_w)/2+c.text_w),f.stroke())):(f.fillText(" "+x.text+" ",G,l+y/2),x.checked&&(f.beginPath(),f.moveTo(G+1,l+c.text_h/4),f.lineTo(G+1+c.text_w-2,l+c.text_h/4+c.text_h/2),f.lineTo(G+1,
l+c.text_h/4+c.text_h),f.lineTo(G+1,l+c.text_h/4),f.fill())))}})))}function g(c,a){e.onWidgetLayer(c,function(){e.erase_window(c)});c.menu=d;c.widget=null;for(var y=0;y<a.items.length;y++){var G=a.items[y];if(G.selected){G.handler?G.handler():G.menu&&(y=G.menu,"function"===typeof G.menu&&(y=G.menu()),y.finalize=a.finalize,e.menu(c,y));break}}!c.menu&&a.finalize&&a.finalize()}function k(c,a){e.onWidgetLayer(c,function(){e.erase_window(c)});c.menu=d;c.widget=null;!c.menu&&a.finalize&&a.finalize()}function h(c,
a,d){var e=!0,f;f=a/c;0<c?f>d.tL?e=!1:f>d.tE&&(d.tE=f):0>c?f<d.tE?e=!1:f<d.tL&&(d.tL=f):0<a&&(e=!1);return e}function B(c,a,d,e,f,n,g,k){0>a&&(a=0);0>d&&(d=0);0>e&&(e=0);0>f&&(f=0);k&&(c.lineWidth=k);g&&(c.strokeStyle=g);1===c.lineWidth%2&&(a===e&&(e=a=Math.floor(a)+0.5),d===f&&(f=d=Math.floor(d)+0.5));if(!n||!n.mode)c.beginPath(),c.moveTo(a,d),c.lineTo(e,f),c.stroke(),c.beginPath();else if("dashed"===n.mode){if(dashOn(c,n.on,n.off))c.beginPath(),c.moveTo(a,d),c.lineTo(e,f),c.stroke(),dashOff(c);
else if(c.beginPath(),d===f)for(f=Math.min(a,e),e=Math.max(a,e);f<e;)c.moveTo(f,d),c.lineTo(f+n.on,d),c.stroke(),f+=n.on+n.off;else if(a===e)for(e=Math.min(d,f),f=Math.max(d,f);e<f;)c.moveTo(a,e),c.lineTo(a,e+n.on),c.stroke(),e+=n.on+n.off;else throw"Only horizontal or vertical dashed lines are supported";c.beginPath()}else if("xor"===n.mode)if("undefined"===typeof Uint8ClampedArray)c.beginPath(),c.moveTo(a,d),c.lineTo(e,f),c.stroke(),c.beginPath();else{g=n=0;if(d===f)n=Math.abs(e-a),g=k,a=Math.min(a,
e);else if(a===e)n=k,g=Math.abs(f-d),d=Math.min(d,f);else throw"Only horizontal and vertical lines can be drawn with XOR";if(0!==n&&0!==g){a=Math.floor(a);d=Math.floor(d);e=c.getImageData(a,d,n,g);f=e.data;n=0;for(k=f.length;n<k;n+=4)f[n]=255-f[n],f[n+1]=255-f[n+1],f[n+2]=255-f[n+2],f[n+3]=255;c.putImageData(e,a,d);c.clearRect(0,0,1,1)}}}function t(c,a,d,e,f){u(c,a,f);d&&(c.strokeStyle=d);e&&(c.fillStyle=e);c.fill();c.closePath()}function u(c,a,d){if(!(1>a.length)){var e=a[0].x,f=a[0].y;c.lineWidth=
d?d:1;c.beginPath();c.moveTo(e,f);for(d=0;d<a.length;d++)e=a[d].x,f=a[d].y,c.lineTo(e,f)}}function z(c){return Math.floor(Math.round(c/100*255))}function A(c,a,d){return"rgb("+Math.round(c)+", "+Math.round(a)+", "+Math.round(d)+")"}function E(c,a){var d,e;if(".000000"===c.substring(5,8))d=4;else for(d=c.length-1;"0"===c[d];)d-=1;for(e=0;" "===c[e]&&(5<d-e+1||a);)e+=1;d=c.substring(e,d+1);-1===d.indexOf(".")&&(d+=".");return d}function I(c){c._animationFrameHandle=d;var a=c.warpbox;c.active_canvas.getContext("2d");
if(a&&c.xpos>=a.xmin&&c.xpos<=a.xmax&&c.ypos>=a.ymin&&c.ypos<=a.ymax){a.xl=c.xpos;a.yl=c.ypos;var y=Math.min(a.xo,a.xl),f=Math.min(a.yo,a.yl),g=Math.abs(a.xl-a.xo),n=Math.abs(a.yl-a.yo);0!==g&&0!==n&&("vertical"===a.mode?(y=c.l,g=c.r-c.l):"horizontal"===a.mode&&(f=c.t,n=c.b-c.t),e.onWidgetLayer(c,function(){e.erase_window(c);e.draw_box(c,"xor",y,f,g,n,a.style.opacity,a.style.fill_color)}))}}function P(c,a,d){return c<a?a:c>d?d:c}function L(c,a,e,f,g,n,k,l,x,h,q,s,C){h===d&&(h=0);q===d&&(q=0);s===
d&&(s=e.width-h);C===d&&(C=e.height-q);c._renderCanvas.width=e.width;c._renderCanvas.height=e.height;for(var r=c._renderCanvas.getContext("2d"),D=r.createImageData(c._renderCanvas.width,c._renderCanvas.height),H=new Uint8Array(e),J=0;J<e.height;++J)for(var p=0;p<e.width;++p){var O=4*(J*e.width+p);D.data[O]=H[O];D.data[O+1]=H[O+1];D.data[O+2]=H[O+2];D.data[O+3]=255}r.putImageData(D,0,0);a.save();a.globalAlpha=f;g||(a.imageSmoothingEnabled=!1,a.mozImageSmoothingEnabled=!1,a.webkitImageSmoothingEnabled=
!1);a.drawImage(c._renderCanvas,h,q,s,C,n,k,l,x);a.restore()}function Q(c,a,e,f,g,n,k,l,x,h,q,s,C){h===d&&(h=0);q===d&&(q=0);s===d&&(s=e.width-h);C===d&&(C=e.height-q);if(32768>e.width&&32768>e.height){c._renderCanvas.width=e.width;c._renderCanvas.height=e.height;var r=c._renderCanvas.getContext("2d"),D=r.createImageData(c._renderCanvas.width,c._renderCanvas.height);e=new Uint8ClampedArray(e);D.data.set(e);r.putImageData(D,0,0)}else 32768>s&&32768>C?(c._renderCanvas.width=s,c._renderCanvas.height=
C,K(c._renderCanvas,e,h,q,s,C)):(c._renderCanvas.width=Math.min(2*l,e.width),c._renderCanvas.height=Math.min(2*x,e.height),K(c._renderCanvas,e,h,q,s,C),s=c._renderCanvas.width,C=c._renderCanvas.height),q=h=0;a.save();a.globalAlpha=f;g||(a.imageSmoothingEnabled=!1,a.mozImageSmoothingEnabled=!1,a.webkitImageSmoothingEnabled=!1);a.drawImage(c._renderCanvas,h,q,s,C,n,k,l,x);a.restore()}function K(c,a,d,e,f,g){var k=new Uint32Array(a);f||(f=a.width);g||(g=a.height);d||(d=0);e||(e=0);var l=c.width,x=c.height;
c=c.getContext("2d");var h=c.createImageData(l,x),q=new ArrayBuffer(h.data.length),s=new Uint8ClampedArray(q),q=new Uint32Array(q);f/=l;g/=x;for(var C=0,r=0,x=C=0;x<q.length;x++)C=Math.round(Math.floor(x%l)*f)+d,r=Math.round(Math.floor(x/l)*g)+e,C=Math.floor(r*a.width+C),q[x]=k[C];h.data.set(s);c.putImageData(h,0,0)}e.XW_INIT=-3;e.XW_DRAW=1;e.XW_EVENT=2;e.XW_UPDATE=3;e.XW_COMMAND=5;e.SB_EXPAND=1;e.SB_SHRINK=2;e.SB_FULL=3;e.SB_STEPINC=4;e.SB_STEPDEC=5;e.SB_PAGEINC=6;e.SB_PAGEDEC=7;e.SB_DRAG=8;e.SB_WHEELUP=
9;e.SB_WHEELDOWN=10;e.L_ArrowLeft=1001;e.L_ArrowRight=1002;e.L_ArrowUp=1003;e.L_ArrowDown=1004;e.L_dashed=801;e.GBorder=3;e.L_RModeOff=900;e.L_RModeOn=901;e.L_PixelSymbol=1;e.L_CircleSymbol=2;e.L_SquareSymbol=3;e.L_PlusSymbol=4;e.L_XSymbol=5;e.L_TriangleSymbol=6;e.L_ITriangleSymbol=7;e.L_HLineSymbol=8;e.L_VLineSymbol=9;e.LEGACY_RENDER=!1;e.STKSTRUCT=function(){this.y2=this.x2=this.y1=this.x1=this.yscl=this.xscl=this.ymax=this.ymin=this.xmax=this.xmin=0};e.SCROLLBAR=function(){this.repeat_count=this.origin=
this.mxevent=this.arrow=this.a2=this.a1=this.soff=this.swmin=this.sw=this.s1=this.h=this.w=this.y=this.x=this.repeat_pause=this.initial_pause=this.dragoutline=this.scale=this.page=this.step=this.trange=this.tmin=this.srange=this.smin=this.action=this.flag=null};e.open=function(c){c=new p(c);c.wid_canvas.oncontextmenu=function(c){c.preventDefault();return!1};this._ctx=c.active_canvas.getContext("2d");c.onmousemove=function(c){return function(a){var f=a.target.getBoundingClientRect();c.x=a.x||a.clientX;
c.y=a.y||a.clientY;c.xpos=a.offsetX===d?a.pageX-f.left-window.scrollX:a.offsetX;c.ypos=a.offsetX===d?a.pageY-f.top-window.scrollY:a.offsetY;c.warpbox&&(c.warpbox.style=(a.ctrlKey||a.metaKey)&&c.warpbox.alt_style!==d?c.warpbox.alt_style:c.warpbox.def_style,e.redraw_warpbox(c));e.widget_callback(c,a)}}(c);c.onmouseup=function(c){return function(a){if(c.warpbox){e.onWidgetLayer(c,function(){e.erase_window(c)});var f=c.warpbox;c.warpbox=d;if((1===a.which||3===a.which)&&f.func){var g=f.xo,n=f.yo,k=f.xl,
l=f.yl;"vertical"===f.mode?(g=c.l,k=c.r):"horizontal"===f.mode&&(n=c.t,l=c.b);f.func(a,g,n,k,l,f.style.return_value,f.mode)}}e.widget_callback(c,a)}}(c);c.onmousedown=function(c){return function(a){a.preventDefault();e.widget_callback(c,a);return!1}}(c);c.onkeydown=function(c){return function(a){if(c.warpbox){var d=getKeyCode(a);17!==d&&224!==d&&91!==d&&93!==d||c.warpbox.style===c.warpbox.alt_style||(c.warpbox.style=c.warpbox.alt_style,e.redraw_warpbox(c))}e.widget_callback(c,a)}}(c);c.onkeyup=function(c){return function(a){c.warpbox&&
(a=getKeyCode(a),17!==a&&224!==a&&91!==a&&93!==a||c.warpbox.style===c.warpbox.def_style||(c.warpbox.style=c.warpbox.def_style,e.redraw_warpbox(c)))}}(c);c.ontouchend=function(c){return function(a){c.onmouseup({which:1})}}(c);c.ontouchmove=function(c){return function(a){var f=c.canvas,g=0,n=0;if(f.offsetParent!==d){do g+=f.offsetLeft,n+=f.offsetTop;while(f=f.offsetParent)}c.xpos=a.targetTouches[0].pageX-g;c.ypos=a.targetTouches[0].pageY-n;e.redraw_warpbox(c)}}(c);e.enableListeners(c);return c};e.enableListeners=
function(c){e.addEventListener(c,"mousemove",c.onmousemove,!1);window.addEventListener("mouseup",c.onmouseup,!1);e.addEventListener(c,"mousedown",c.onmousedown,!1);window.addEventListener("keydown",c.onkeydown,!1);window.addEventListener("keyup",c.onkeyup,!1)};e.disableListeners=function(c){e.removeEventListener(c,"mousemove",c.onmousemove,!1);window.removeEventListener("mouseup",c.onmouseup,!1);e.removeEventListener(c,"mousedown",c.onmousedown,!1);window.removeEventListener("keydown",c.onkeydown,
!1);window.removeEventListener("keyup",c.onkeyup,!1)};e.addEventListener=function(c,a,d,e){return c.wid_canvas.addEventListener(a,d,e)};e.removeEventListener=function(c,a,d,e){return c.wid_canvas.removeEventListener(a,d,e)};e.dispatchEvent=function(c,a){return c.wid_canvas.dispatchEvent(a)};e.onWidgetLayer=function(c,a){e.onCanvas(c,c.wid_canvas,a)};e.onCanvas=function(c,a,d){var e=c.active_canvas;c.active_canvas=a;try{if(d)return d()}finally{c.active_canvas=e}};e.withWidgetLayer=function(c,a){return function(){e.onWidgetLayer(c,
a)}};e.render=function(c,a){if(a){var e=c.active_canvas;e._animationFrameHandle||(e._animationFrameHandle=requestAnimFrame(function(){e._animationFrameHandle=d;a()}))}};e.fullscreen=function(c,a){a===d&&(a=!c.fullscreen);a?(c.fullscreen={position:c.root.style.position,height:c.root.style.height,width:c.root.style.width,left:c.root.style.left,top:c.root.style.top,zIndex:c.root.style.zIndex},c.root.style.position="fixed",c.root.style.height="100%",c.root.style.width="100%",c.root.style.left="0px",c.root.style.top=
"0px",c.root.style.zIndex=16777271):(c.root.style.position=c.fullscreen.position,c.root.style.height=c.fullscreen.height,c.root.style.width=c.fullscreen.width,c.root.style.left=c.fullscreen.left,c.root.style.top=c.fullscreen.top,c.root.style.zIndex=c.fullscreen.zIndex,c.fullscreen=d);e.checkresize(c)};e.checkresize=function(c){var a=c.canvas;return a.height!==c.root.clientHeight||a.width!==c.root.clientWidth?(c.height=c.root.clientHeight,c.width=c.root.clientWidth,c.canvas.height=c.height,c.canvas.width=
c.width,c.wid_canvas.height=c.height,c.wid_canvas.width=c.width,!0):!1};e.invertbgfg=function(c){e.setbgfg(c,c.fg,c.bg,!c.xi)};e.mixcolor=function(c,a,d){c=tinycolor(c).toRgb();a=tinycolor(a).toRgb();var e=1-d;a.r=c.r*e+a.r*d;a.g=c.g*e+a.g*d;a.b=c.b*e+a.b*d;return tinycolor(a).toHexString(!0)};e.linear_gradient=function(c,a,d,e,f,g){var k=c.active_canvas.getContext("2d");c=1/g.length;a=k.createLinearGradient(a,d,e,f);for(d=0;d<g.length-1;d++)a.addColorStop(c*d,g[d]);a.addColorStop(1,g[g.length-1]);
return a};e.setbgfg=function(c,a,d,f){c.bg=tinycolor(a).toHexString();c.fg=tinycolor(d).toHexString();c.xi=tinycolor(f).toHexString();tinycolor.equals(c.bg,"black")&&tinycolor.equals(c.fg,"white")?(c.xwfg=c.fg,c.xwbg="rgb(35%,35%,30%)",c.xwts="rgb(60%,60%,55%)",c.xwbs="rgb(25%,25%,20%)",c.xwms=e.mixcolor(c.xwts,c.xwbs,0.5),c.xwlo="rgb(15%,15%,10%)",c.hi=c.xwts):tinycolor.equals(c.bg,"white")&&tinycolor.equals(c.fg,"black")?(c.xwfg=c.fg,c.xwbg="rgb(60%,60%,55%)",c.xwts="rgb(80%,80%,75%)",c.xwbs="rgb(40%,40%,35%)",
c.xwms=e.mixcolor(c.xwts,c.xwbs,0.5),c.xwlo="rgb(70%,70%,65%)",c.hi=c.xwbs):(a=tinycolor(c.bg).toRgb(),127.5<Math.sqrt(0.299*a.r*a.r+0.587*a.g*a.g+0.114*a.b*a.b)?(c.xwfg="black",c.xwbg="rgb(60%,60%,55%)",c.xwts="rgb(80%,80%,75%)",c.xwbs="rgb(40%,40%,35%)",c.xwms=e.mixcolor(c.xwts,c.xwbs,0.5),c.xwlo="rgb(70%,70%,65%)",c.hi=c.xwts):(c.xwfg="white",c.xwbg="rgb(35%,35%,30%)",c.xwts="rgb(60%,60%,55%)",c.xwbs="rgb(25%,25%,20%)",c.xwms=e.mixcolor(c.xwts,c.xwbs,0.5),c.xwlo="rgb(15%,15%,10%)",c.hi=c.xwbs))};
e.settheme=function(c,a){c.bg=a.bg;c.fg=a.fg;c.xi=a.xi;c.xwfg=a.xwfg;c.xwbg=a.xwbg;c.xwts=a.xwts;c.xwbs=a.xwbs;c.xwlo=a.xwlo;c.hi=a.hi};e.close=function(c){var a=c.wid_canvas;a.removeEventListener("mousemove",c.onmousemove,!1);a.removeEventListener("mouseup",c.onmouseup,!1);c.parent&&c.parent.parentNode&&c.parent.parentNode.removeChild(c.parent)};e.scrollbar=function(c,a,f,g,k,n,l,h,x,p,q){var s,C,r,D=0,H=new e.SCROLLBAR;s=a.flag!==d?a.flag:a;C=Math.abs(s);r=n-k>g-f?3>c.origin?2:4:c.origin&2?3:1;
10>C&&(a=H);if(10>C||0===a.action)e.scroll(c,a,e.XW_INIT,d,q),a.flag=s,a.initial_pause=-1,e.scroll_loc(a,f,k,g-f+1,n-k+1,r,q);a.srange=l.pe-l.ps;switch(C){case 0:f=g=k=1;break;case 1:case 11:f=g=0.9*a.srange;k=2;break;case 2:case 12:f=0.1*a.srange;g=9*f;k=2;break;case 3:case 13:f=1;g=a.srange-1;k=1;break;default:return 0}e.scroll_vals(a,l.ps,a.srange,h,x-h,f,g,k,q);0===s?e.scroll(c,a,e.XW_DRAW,d,d):e.scroll(c,a,e.XW_EVENT,p,q)&&(l.ps!==a.smin&&(l.ps=a.smin,D+=1),l.pe!==a.smin+a.srange&&(l.pe=a.smin+
a.srange,D+=2));return D};e.scroll=function(c,a,f,g,k){var n;if(a===d)return!1;switch(f){case e.XW_INIT:e.scroll_loc(a,0,0,c.width,20,1,k);e.scroll_vals(a,0,10,0,100,1,10,1,k);a.flag=0;a.action=0;a.initial_pause=0.25;a.repeat_pause=0.05;a.mxevent=!0;a.repeat_count=0;break;case e.XW_EVENT:n=0;if(a.mxevent)n=c.button_release?-c.button_release:c.button_press;else if("mousedown"===g.type||"mouseup"===g.type){switch(g.which){case 1:n=1;break;case 2:n=2;break;case 3:n=3;break;case 4:n=4;break;case 5:n=
5}"mouseup"===g.type&&(n=-n)}else if("mousewheel"===g.type||"DOM-MouseScroll"===g.type)g.wheelDelta&&0<g.wheelDelta?n=4:g.wheelDelta&&0>g.wheelDelta&&(n=5);if(0===a.action){if(4===n||5===n)c.xpos=a.x;if(1!==n&&2!==n&&4!==n&&5!==n||c.xpos<a.x||c.ypos<a.y||c.xpos>a.x+a.w||c.ypos>a.y+a.h)return!1}else if(0>n){a.action=a.repeat_count=0;break}a.origin&1?(g=c.xpos-a.x,a.origin&2&&(g=a.w-g)):(g=c.ypos-a.y,2>=a.origin&&(g=a.h-g));if(0===a.action){a.repeat_count=0;var l=e.scroll_real2pix(a);a.s1=k.s1=l.s1;
a.sw=k.sw=l.sw;a.soff=k.soff=g-a.s1;if(0===a.trange)a.smin=k.smin=a.tmin,a.srange=k.srange=0;else switch(n){case 1:a.action=g>a.a1&&g<a.a2?0<a.soff?e.SB_PAGEINC:e.SB_PAGEDEC:0<a.soff?e.SB_STEPINC:e.SB_STEPDEC;break;case 4:a.action=e.SB_WHEELUP;break;case 5:a.action=e.SB_WHEELDOWN;break}}else switch(a.action){case e.SB_WHEELUP:case e.SB_WHEELDOWN:case e.SB_EXPAND:case e.SB_SHRINK:case e.SB_FULL:a.action=a.repeat_count=0}case e.XW_COMMAND:n=a.smin;g=a.srange;switch(a.action){case e.SB_STEPINC:n+=a.step;
break;case e.SB_STEPDEC:n-=a.step;break;case e.SB_PAGEINC:n+=a.page;break;case e.SB_PAGEDEC:n-=a.page;break;case e.SB_FULL:n=a.tmin;g=a.trange;break;case e.SB_EXPAND:g*=a.scale;n=0>=n&&0<=n+a.srange?n*a.scale:n-(g-a.srange)/2;break;case e.SB_SHRINK:g/=a.scale;n=0>n&&0<=n+a.srange?n+g/a.scale:0===n&&0<=n+a.srange?g/a.scale:n+(a.srange-g)/2;break;case e.SB_WHEELUP:n-=a.page;break;case e.SB_WHEELDOWN:n+=a.page}0<a.trange?(n=Math.max(a.tmin,Math.min(n,a.tmin+a.trange-g)),g=Math.min(g,a.trange)):(n=Math.min(a.tmin,
Math.max(n,a.tmin+a.trange-g)),g=Math.max(g,a.trange));a.smin===n&&a.srange===g?a.action!==e.SB_DRAG&&(a.action=a.repeat_count=0):(a.smin=k.smin=n,a.srange=k.srange=g,a.repeat_count++);f===e.XW_COMMAND&&(e.scroll(c,a,e.XW_UPDATE,d),a.action=0);break;case e.XW_DRAW:case e.XW_UPDATE:e.redrawScrollbar(a,c,f)}return!0};e.scroll_loc=function(c,v,f,g,k,n,l){c!==d&&(c.x=l.x=v,c.y=l.y=f,c.w=l.w=g,c.h=l.h=k,c.origin=l.origin=Math.max(1,Math.min(4,n)),c.origin&1?(c.a2=l.a2=c.w,c.arrow=l.arrow=Math.min(a.trunc((c.w-
a.trunc(2*e.GBorder))/3),c.h+e.GBorder)):(c.a2=l.a2=c.h,c.arrow=l.arrow=Math.min(a.trunc((c.h-a.trunc(2*e.GBorder))/3),c.w+e.GBorder)),c.a1=l.a1=c.arrow+e.GBorder,c.a2-=c.arrow+e.GBorder,l.a2-=c.arrow+e.GBorder,c.swmin=l.swmin=Math.min(10,c.a2-c.a1),c.s1=l.s1=0,c.sw=l.sw=0,c.action=l.action=0)};e.scroll_vals=function(c,a,e,f,g,n,k,l,x){c!==d&&(c.smin=x.smin=a,c.srange=x.srange=e,c.tmin=x.tmin=f,c.trange=x.trange=g,c.step=x.step=n,c.page=x.page=k,c.scale=x.scale=Math.max(l,1))};e.draw_symbol=function(c,
d,f,g,k,n,l){for(var h=c.active_canvas.getContext("2d"),x=0,p=0,q=!1,s=[],p=0;4>p;p++)s[p]={x:0,y:0};p="";q=0>n;x=Math.abs(n);p=2*x;h.fillStyle=d;h.strokeStyle=d;if("function"===typeof k)k(h,l,f,g);else switch(k){case e.L_CircleSymbol:h.beginPath();q?(h.arc(f,g,x,0,360),h.fill()):(h.arc(f,g,x,0,360),h.stroke());break;case e.L_SquareSymbol:q?h.fillRect(f-x,g-x,p,p):h.strokeRect(f-x,g-x,p,p);break;case e.L_PixelSymbol:h.beginPath();h.arc(f,g,1,0,2*Math.PI,!0);h.fill();break;case e.L_ITriangleSymbol:x=
-x;case e.L_TriangleSymbol:p=a.trunc(1.5*x);f=a.trunc(0.8*x);s[1].x=-f;s[1].y=p;s[2].x=2*f;s[2].y=0;s[3].x=-f;s[3].y=-p;c=[];for(p=0;4>p;p++)c[p]={x:0,y:0};q?(c[0].x=f,c[0].y=g-x,c[1].x=c[0].x+s[1].x,c[1].y=c[0].y+s[1].y,c[2].x=c[1].x+s[2].x,c[2].y=c[1].y+s[2].y,c[3].x=c[2].x+s[3].x,c[3].y=c[2].y+s[3].y,t(h,c)):(c[0].x=f,c[0].y=g-x,c[1].x=c[0].x+s[1].x,c[1].y=c[0].y+s[1].y,c[2].x=c[1].x+s[2].x,c[2].y=c[1].y+s[2].y,c[3].x=c[2].x+s[3].x,c[3].y=c[2].y+s[3].y,u(h,c,void 0),h.stroke(),h.closePath());break;
case e.L_PlusSymbol:B(h,f,g+x,f,g-x);B(h,f+x,g,f-x,g);break;case e.L_HLineSymbol:B(h,f+x,g,f-x,g);break;case e.L_VLineSymbol:B(h,f,g+x,f,g-x);break;case e.L_XSymbol:B(h,f-x,g-x,f+x,g+x);B(h,f+x,g-x,f-x,g+x);break;default:p=k,x=a.trunc(c.text_w/2),q&&h.fillText(p.substring(0,2),f-x,g+x)}};e.draw_symbols=function(c,a,d,f,g,n,k,l){for(var x=0;x<g;x++)e.draw_symbol(c,a,d[x],f[x],n,k,x+l)};e.trace=function(c,v,g,k,l,n,p,T,x,W,q){if(g===d||k===d)throw"mx.trace requires xpoint and ypoint";p===d&&(p=1);T===
d&&(T=1);x===d&&(x=0);W===d&&(W=0);q===d&&(q={});if(0>=l)a.log.warn("No points to draw");else if(0===T&&0===x)a.log.warn("No line or symbol to draw");else{var s;q.dashed&&(s={mode:"dashed",on:4,off:4});var C=e.origin(c.origin,4,c.stk[c.level]);if(0!==C.xscl&&0!==C.yscl){var r=C.x1,D=C.y1,H=C.xmin,J=1/C.xscl,N=C.ymin,O=1/C.yscl;q.noclip||e.clip(c,r,D,C.x2-r+1,C.y2-D+1);var t=Math.abs(C.xmax-C.xmin),B=Math.abs(C.ymax-C.ymin),R=Math.min(C.xmin,C.xmax),C=Math.min(C.ymin,C.ymax),U=R+t,Y=C+B,S=4*Math.ceil(2*
g.length),A=new Int32Array(new ArrayBuffer(S)),S=new Int32Array(new ArrayBuffer(S)),z=0;if(0===T&&0!==x)for(var u=p-1;u<l;u+=p){var w=g[u],E=k[u],I=w>=R&&w<=U&&E>=C&&E<=Y;I&&(A[0]=Math.round((w-H)*J)+r,S[0]=Math.round((E-N)*O)+D,e.draw_symbol(c,v,A[0],S[0],x,W,n+u))}else if(!0===q.vertsym&&0!==x)for(u=p-1;u<l;u+=p)w=g[u],E=k[u],w>=R&&w<=U&&(T=Math.round((w-H)*J)+r,e.draw_line(c,v,T,0,T,c.height),E>=C&&E<=Y&&(A[0]=T,S[0]=Math.round((E-N)*O)+D,e.draw_symbol(c,v,A[0],S[0],x,W,n+u)));else if(!0===q.horzsym&&
0!==x)for(u=p-1;u<l;u+=p)w=g[u],E=k[u],E>=C&&E<=Y&&(T=Math.round((E-N)*O)+D,e.draw_line(c,v,0,T,c.width,T),w>=R&&w<=U&&(A[0]=Math.round((w-H)*J)+r,S[0]=T,e.draw_symbol(c,v,A[0],S[0],x,W,n+u)));else if(0!==T){var F;if(q&&q.highlight){F=[];for(u=0;u<q.highlight.length;u++)if(!(q.highlight[u].xstart>=U||q.highlight[u].xend<=R)&&(w=Math.max(q.highlight[u].xstart,R),E=Math.min(q.highlight[u].xend,U),w<E)){w=Math.round((w-H)*J)+r;E=Math.round((E-H)*J)+r;for(t=F.length-1;0<=t;t--)w<=F[t].start&&E>=F[t].end?
F.splice(t,1):w>=F[t].start&&E<=F[t].end?(F.push({start:E,end:F[t].end,color:F[t].color}),F[t].end=w):w<=F[t].start&&E>=F[t].start?F[t].start=E:w<=F[t].end&&E>=F[t].end&&(F[t].end=w),F[t].end<=F[t].start&&F.splice(t,1);F.push({start:w,end:E,color:q.highlight[u].color})}F.push({start:r,color:v});F.sort(function(c,a){return c.start-a.start})}else F=v;var L,P=(c.stk[c.level].xmax+c.stk[c.level].xmin)/2,Q=(c.stk[c.level].ymax+c.stk[c.level].ymin)/2,w=g[0],E=k[0];L=f(0,P,Q,c.stk[c.level].xmin,c.stk[c.level].ymin,
w,E);(I=w>=R&&w<=U&&E>=C&&E<=Y)?(A[z]=Math.round((w-H)*J)+r,S[z]=Math.round((E-N)*O)+D,z+=1,0!==x&&e.draw_symbols(c,v,A,S,1,x,W,n)):z=0;for(var K=0,V=!1,u=p;u<=p*(l-1);u+=p)if(t=w,B=E,w=g[u],E=k[u],L=f(L,P,Q,t,B,w,E),V=w>=R&&w<=U&&E>=C&&E<=Y,I&&V)A[z]=Math.round((w-H)*J)+r,S[z]=Math.round((E-N)*O)+D,z+=1;else if(I=V,t-=w,B-=E,0!==t||0!==B){var X={tL:1,tE:0};h(t,R-w,X)&&h(-t,w-U,X)&&h(B,C-E,X)&&h(-B,E-Y,X)&&(1>X.tL&&(A[z]=Math.round((w-H+X.tL*t)*J)+r,S[z]=Math.round((E-N+X.tL*B)*O)+D,z+=1),0<X.tE?
(A[z]=Math.round((w-H+X.tE*t)*J)+r,S[z]=Math.round((E-N+X.tE*B)*O)+D,z+=1,e.draw_lines(c,F,A.subarray(K,z),S.subarray(K,z),z-K,T,s),0!==x&&2<z-K&&e.draw_symbols(c,v,A.subarray(K+1,z-1),S.subarray(K+1,z-1),z-K-2,x,W,n+u-(z-K-2)),K=z):(A[z]=Math.round((w-H)*J)+r,S[z]=Math.round((E-N)*O)+D,z+=1))}L=f(L,P,Q,w,E,c.stk[c.level].xmax,c.stk[c.level].ymin);L=f(L,P,Q,c.stk[c.level].xmax,c.stk[c.level].ymin,c.stk[c.level].xmin,c.stk[c.level].ymin);0<z-K&&(e.draw_lines(c,F,A.subarray(K,z),S.subarray(K,z),z-K,
T,s),V&&(K+=1),0!==x&&1<z-K&&e.draw_symbols(c,v,A.subarray(K-1,z),S.subarray(K-1,z),z,x,W,u-z+n));q.fillStyle&&(1<z||0!==L)&&e.fill_trace(c,q.fillStyle,A,S,z)}q.noclip||e.clip(c,0,0,0,0)}}};e.draw_mode=function(c,a,e){c.linewidth=a===d?1:a;c.style=e};e.draw_line=function(c,e,f,g,k,n,l,h){var x=c.active_canvas.getContext("2d");l===d&&(l=c.linewidth);h===d&&(h=c.style);"number"===typeof e&&(c.pixel&&0!==c.pixel.length?(e=Math.max(0,Math.min(c.pixel.length,e)),e=A(c.pixel[e].red,c.pixel[e].green,c.pixel[e].blue)):
(a.log.warn("COLORMAP not initialized, defaulting to foreground"),e=c.fg));B(x,f,g,k,n,h,e,l)};e.rubberline=function(c,a,d,e,f){c=c.active_canvas.getContext("2d");B(c,a,d,e,f,{mode:"xor"},"white",1)};e.fill_trace=function(c,a,d,f,g){var n=c.active_canvas.getContext("2d");Array.isArray(a)?n.fillStyle=e.linear_gradient(c,0,0,0,c.b-c.t,a):n.fillStyle=a;if(1>g)n.fillRect(c.l,c.t,c.r-c.l,c.b-c.t);else if(a){a=d[0];var k=f[0];n.beginPath();k===c.t?n.lineTo(c.l,c.t):n.lineTo(c.l,c.b);n.lineTo(a,k);for(var l=
1;l<g;l++)a=d[l],k=f[l],n.lineTo(a,k);k===c.t&&n.lineTo(c.r,c.t);n.lineTo(c.r,c.b);f[0]===c.t&&n.lineTo(c.l,c.b);n.closePath();n.fill()}};e.draw_lines=function(c,e,f,g,k,n,l){var h=c.active_canvas.getContext("2d");if(!(1>k)){var x=f[0],p=g[0];n===d&&(n=c.linewidth);l===d&&(l=c.style);l&&"dashed"===l.mode&&(dashOn(h,l.on,l.off)||a.log.warn("WARNING: Dashed lines aren't supported on your browser"));h.lineWidth=n;c=0;"string"===typeof e?e=[{start:0,color:e}]:e instanceof Array||(e.start===d&&(e.start=
0),e=[e]);for(n=0;n<e.length;n++)null!=e[n].end&&e[n].end<x?e.remove(n):e[n].start<x&&(c=n);h.strokeStyle=e[c].color;h.beginPath();h.moveTo(x,p);for(n=0;n<k;n++)if(x!==f[n]||p!==g[n]){x=f[n];p=g[n];l=!1;if(0<c&&null!=e[c].end&&e[c].end<x)for(l=!0;null!=e[c].end&&e[c].end<x&&(e.remove(c),c-=1,0!==c););if(c+1<e.length&&e[c+1].start<=x)for(l=!0;c+1<e.length&&e[c+1].start<=x;)c++;h.lineTo(x,p);l&&(h.stroke(),h.strokeStyle=e[c].color,h.beginPath(),h.lineTo(x,p))}h.stroke();dashOff(h);h.beginPath()}};e.clip=
function(c,a,d,e,f){c=c.active_canvas.getContext("2d");0===a&&0===d&&0===e&&0===f?c.restore():(c.save(),c.beginPath(),c.rect(a,d,e,f),c.clip())};e.clear_window=function(c){var a=c.active_canvas.getContext("2d");a.fillStyle=c.bg;a.fillRect(0,0,c.width,c.height)};e.erase_window=function(c){c.active_canvas.getContext("2d").clearRect(0,0,c.width,c.height)};e.rubberbox=function(c,a,d,f,g){e.warpbox(c,c.xpos,c.ypos,c.xpos,c.ypos,0,c.width,0,c.height,a,d,f,g)};e.warpbox=function(c,a,d,e,f,g,k,l,h,p,q,s,
C){s||(s={});c.warpbox=new w;c.warpbox.xo=a;c.warpbox.yo=d;c.warpbox.xl=e;c.warpbox.yl=f;c.warpbox.xmin=g;c.warpbox.xmax=k;c.warpbox.ymin=l;c.warpbox.ymax=h;c.warpbox.func=p;c.warpbox.mode=q;c.warpbox.style=s;c.warpbox.def_style=s;c.warpbox.alt_style=C};e.origin=function(c,a,d){c=Math.max(1,c);a=Math.max(1,a);var f=new e.STKSTRUCT;f.xmin=d.xmin;f.xmax=d.xmax;f.ymin=d.ymin;f.ymax=d.ymax;f.xscl=d.xscl;f.yscl=d.yscl;f.x1=d.x1;f.y1=d.y1;f.x2=d.x2;f.y2=d.y2;if(c!==a){var g=Math.abs(a-c);c=a+c;if(2===g||
5!==c)f.xmin=d.xmax,f.xmax=d.xmin,f.xscl=-d.xscl;if(2===g||5===c)f.ymin=d.ymax,f.ymax=d.ymin,f.yscl=-d.yscl}return f};e.mult=function(c,a){var d=Math.max(Math.abs(c),Math.abs(a));if(0===d)return 1;var e=0.1447648*Math.log(d),e=e|e;1>d&&(e-=1);return 0>e?1/Math.pow(10,-3*e):Math.pow(10,3*e)};e.widget_callback=function(c,a){if(c.prompt&&3===a.which)c.prompt.input.onsubmit();c.widget&&c.widget.callback(a)};e.prompt=function(c,a,f,g,k,n,l,h,x){if(n!==d&&(k=f(n),!k.valid))throw"Prompt default input value not valid due to '"+
k.reason+"'";e.onWidgetLayer(c,function(){var k=c.active_canvas.getContext("2d"),q=k.font.indexOf("px"),s=q+3,q=k.font.substr(0,q),k=k.font.substr(s,k.font.length).toString(),k=new CanvasInput({height:c.text_h,fontFamily:k,fontSize:new Number(q),backgroundColor:c.bg,fontColor:c.fg,borderWidth:0,borderRadius:0,padding:0,boxShadow:"none",innerShadow:"none",width:30*c.text_w,value:n!==d?n.toString():"",disableBlur:!0,renderOnReturn:!1,tabToClear:!0}),C=function(a,q){return function(){var s=this.value(),
C=f(s);C.valid?(c.prompt=d,this.cleanup(),e.onWidgetLayer(c,function(){e.erase_window(c)}),g(s)):(e.message(c,"Value: '"+s+"' isn't valid due to '"+C.reason+"' - RETRY",d,a,q),setTimeout(function(){e.onWidgetLayer(c,function(){e.erase_window(c)});c.widget=null},null!=x?x:4E3))}},s=function(c,a,d){return function(q,s){e.onWidgetLayer(c,function(){var f=(d.length+2)*c.text_w,g=f+31*c.text_w+6,v=2*c.text_h+6;q||(q=c.xpos);s||(s=c.ypos);var n=Math.max(0,Math.min(q,c.width-g)),y=Math.max(0,Math.min(s,
c.height-v)),k=n+3,l=y+3,h=l+1.5*c.text_h,x=k+c.text_w;e.widgetbox(c,n,y,g,v,k,l,0,"");e.text(c,x,h,d);g=h-1.15*c.text_h;a.x(k+c.text_w+f-c.text_w);a.y(g);a.onsubmit(C(n,g-75));a.canvas()?a.render():a.canvas(c.active_canvas)})}}(c,k,a);s(l,h);k.focus();c.prompt={redraw:s,input:k}})};e.floatValidator=function(c,a){return(a!==d&&!1!==a||""!==c)&&isNaN(parseFloat(c))||!isFinite(c)?{valid:!1,reason:"Failed float validation: not a valid floating point number"}:{valid:!0,reason:""}};e.intValidator=function(c,
a){return(a===d||!1===a)&&""===c||parseFloat(c)===parseInt(c,10)&&!isNaN(c)?{valid:!0,reason:""}:{valid:!1,reason:"Failed integer validation: not a valid integer"}};e.message=function(c,a,d,f,g,n){e.onWidgetLayer(c,function(){e.render_message_box(c,a,f,g);c.widget={type:n||"ONESHOT",callback:function(a){if("mousedown"===a.type||"keydown"===a.type)c.widget=null,e.onWidgetLayer(c,function(){e.erase_window(c)})}}})};e.render_message_box=function(c,a,d,f,g){var n=a.split(/\r\n|\r|\n/g),k=0,l;if(1===n.length){k=
Math.min((c.width-6)/c.text_w-2,a.length);if(0>=k)return;for(;40<k&&2.5*c.text_h*a.length<c.height*k;)k-=5;var h=0,p=0,q=0,s=0,C=0,r=0,n=[];for(l=!0;p<a.length;){for(var C=p+k-1,r=C=Math.min(C,a.length-1),D=!1,h=p;h<=C&&!D;h++)switch(a[h]){case ",":case ";":case " ":case ":":r=h;break;case "-":case "/":r!==h-1&&(r=h);break;case "@":case "\n":case "\r":l=!1,D=!0,r=h}h===a.length&&(r=C);D?n.push(a.substring(p,r)):(h=a.substring(p,r+1).replace(/^\s+/,""),n.push(h));p=r+1;s=Math.max(s,n[q].length)}}else for(q=
0;q<n.length;q++)k=Math.min((c.width-6)/c.text_w-2,Math.max(k,n[q].length));s=n.length;6<s&&(l=!1);h=0;q=Math.max(1,c.height/c.text_h);a=Math.min(s,h+q-1);k=(k+2)*c.text_w+6;s=(a-h+1)*c.text_h+6;d||(d=c.xpos);f||(f=c.ypos);d=Math.max(c.l,Math.min(d,c.r-k));q=Math.max(c.t,Math.min(f,c.b-s));f=d+3;r=q+3;e.widgetbox(c,d,q,k,s,f,r,0,"");s=r+c.text_h/3;for(q=f+c.text_w;h<a;)s+=c.text_h,l&&(q=d+k/2-n[h].length*c.text_w/2),e.text(c,q,s,n[h],g),h++};e.draw_round_box=function(c,a,e,f,g,n,k,l,h){c=c.active_canvas.getContext("2d");
h||(h=5);c.beginPath();c.moveTo(e+h,f);c.lineTo(e+g-h,f);c.quadraticCurveTo(e+g,f,e+g,f+h);c.lineTo(e+g,f+n-h);c.quadraticCurveTo(e+g,f+n,e+g-h,f+n);c.lineTo(e+h,f+n);c.quadraticCurveTo(e,f+n,e,f+n-h);c.lineTo(e,f+h);c.quadraticCurveTo(e,f,e+h,f);c.closePath();c.lineWidth=1;c.strokeStyle=a;c.stroke();k!==d&&0<k&&(e=c.globalAlpha,c.globalAlpha=k,c.fillStyle=l?l:a,c.fill(),c.globalAlpha=e)};e.draw_box=function(c,a,e,f,g,n,k,l){var h=c.active_canvas.getContext("2d");if("xor"!==a)h.lineWidth=1,h.strokeStyle=
a,h.strokeRect(e,f,g,n);else if("undefined"===typeof Uint8ClampedArray)h.lineWidth=1,h.strokeStyle=c.fg,h.strokeRect(e,f,g,n);else{e=Math.floor(e);f=Math.floor(f);g=Math.floor(g);n=Math.floor(n);c=c.canvas.getContext("2d");for(var p=c.getImageData(e,f,g,1),q=p.data,s=0;s<p.data.length;s++)q[4*s]=255-q[4*s],q[4*s+1]=255-q[4*s+1],q[4*s+2]=255-q[4*s+2],q[4*s+3]=255;h.putImageData(p,e,f);p=c.getImageData(e,f+n,g,1);q=p.data;for(s=0;s<p.data.length;s++)q[4*s]=255-q[4*s],q[4*s+1]=255-q[4*s+1],q[4*s+2]=
255-q[4*s+2],q[4*s+3]=255;h.putImageData(p,e,f+n);p=c.getImageData(e,f,1,n);q=p.data;for(s=0;s<n;s++)q[4*s]=255-q[4*s],q[4*s+1]=255-q[4*s+1],q[4*s+2]=255-q[4*s+2],q[4*s+3]=255;h.putImageData(p,e,f);p=c.getImageData(e+g,f,1,n);q=p.data;for(s=0;s<n;s++)q[4*s]=255-q[4*s],q[4*s+1]=255-q[4*s+1],q[4*s+2]=255-q[4*s+2],q[4*s+3]=255;h.putImageData(p,e+g,f)}k!==d&&0<k&&(c=h.globalAlpha,h.globalAlpha=k,h.fillStyle=l?l:a,h.fillRect(e+1,f+1,g-1,n-1),h.globalAlpha=c)};e.set_font=function(c,a){var d=c.canvas.getContext("2d"),
e=c.wid_canvas.getContext("2d");if(c.font&&c.font.width===a)d.font=c.font.font,e.font=c.font.font;else{var f=1;do{f+=1;d.font=f+"px Courier New, monospace";e.font=f+"px Courier New, monospace";var g=d.measureText("M");c.text_w=g.width;c.text_h=f}while(c.text_w<a);c.font={font:f+"px Courier New, monospace",width:a}}};e.textline=function(c,a,d,e,f,g){var k=c.active_canvas.getContext("2d");g||(g={});g.color||(g.color=c.fg);g.width||(g.width=1);B(k,a,d,e,f,g,g.color,g.width)};e.tics=function(c,a,d,e){var f=
1,g=c;if(a===c)return{dtic:1,dtic1:c};f=Math.abs(a-c)/d;d=Math.max(f,1E-36);d=Math.log(d)/Math.log(10);0>d?(d=Math.ceil(d),d-=1):d=Math.floor(d);f*=Math.pow(10,-d);d=Math.pow(10,d);g=f*d;e&&5<=g&&5140800>=g?(e=17.5>g?5:37.5>g?15:270>g?60:1050>g?300:2250>g?900:7200>g?3600:16200>g?10800:32400>g?21600:129600>g?43200:518400>g?86400:604800,f=Math.round(g/e)*e):f=1.75>f?d:2.25>f?2*d:3.5>f?2.5*d:7>f?5*d:10*d;0===f&&(f=1);a>=c?(e=Math.floor(0<=c?c/f+0.995:c/f-0.005),g=e*f):(e=Math.floor(0<=c?c/f+0.005:c/
f-0.995),g=e*f,f*=-1);g+f===g&&(f=a-c);return{dtic:f,dtic1:g}};e.drawaxis=function(c,f,g,k,l,n){var h=e.origin(c.origin,1,c.stk[c.level]),p=0,x=0,t=0,q=0,s=0,C=0;k=k===d?30:k;l=l===d?30:l;n.exactbox?(p=Math.floor(h.x1),x=Math.floor(h.y1),t=Math.floor(h.x2),q=Math.floor(h.y2),s=t-p,C=q-x):(p=Math.max(Math.floor(h.x1)-2,0),x=Math.max(Math.floor(h.y1)-2,0),t=Math.min(Math.floor(h.x2)+2,c.width),q=Math.min(Math.floor(h.y2)+2,c.height),s=t-p-4,C=q-x-4);var r=c.active_canvas.getContext("2d");n.fillStyle?
Array.isArray(n.fillStyle)?r.fillStyle=e.linear_gradient(c,0,0,0,q-x,n.fillStyle):r.fillStyle=n.fillStyle:r.fillStyle=c.bg;r.fillRect(p,x,t-p,q-x);n.noaxisbox||(e.textline(c,p,x,t,x),e.textline(c,t,x,t,q),e.textline(c,t,q,p,q),e.textline(c,p,q,p,x));var D=!1;4===k&&(D=!0);r=!1;4===l&&(r=!0);var H={dtic:0,dtic1:0},J={dtic:0,dtic1:0};0>f?(H.dtic1=h.xmin,H.dtic=(h.xmin-h.xmax)/f):H=e.tics(h.xmin,h.xmax,f,D);var N=1;n.xmult?N=n.xmult:D||(N=e.mult(h.xmin,h.xmax));0>g?(J.dtic1=h.ymin,J.dtic=(h.ymin-h.ymax)/
g):J=e.tics(h.ymin,h.ymax,g,r);f=1;n.ymult?f=n.ymult:r||(f=e.mult(h.ymin,h.ymax));var O=!n.noxtlab;g=!n.noytlab;var z=Math.max(0,p-4*c.text_w),B=0,B=n.ontop?Math.min(c.height,Math.floor(q+1.5*c.text_h)):Math.max(c.text_h,Math.floor(x-0.5*c.text_h)),R,U;0<B&&(n.noyplab||(U=a.label(l,f)),n.noxplab||(R=a.label(k,N)));R&&U?e.text(c,z,B,U+" vs "+R):R?e.text(c,z,B,R):U&&e.text(c,z,B,U);k=5.5*c.text_w;l=0;l=n.ontop?n.inside?x+1*c.text_h:x-0.2*c.text_h:n.inside?q-0.5*c.text_h:q+1*c.text_h+2;s=h.xmin!==h.xmax?
s/(h.xmax-h.xmin):s/1;N=0!==N?1/N:1;R=Math.min(12,Math.round(s*H.dtic)/c.text_w);U=1;var A="";if(O)if(D)A=a.sec2tod(H.dtic1),U=A.length*c.text_w<(t-p)/2;else for(var u,B=H.dtic1;B<=h.xmax;B+=H.dtic){A=e.format_f(B*N,R,R/2);if(A===u){U=0;break}u=A}0===H.dtic&&(H.dtic=h.xmax-H.dtic1+1);z=0;A="";for(B=H.dtic1;B<=h.xmax;B+=H.dtic)if(u=p+Math.round(s*(B-h.xmin))+2,!(u<p)&&(n.grid&&"y"!==n.grid?(n.gridStyle||(n.gridStyle=e.LEGACY_RENDER?{mode:"dashed",on:1,off:3}:{color:c.xwms,mode:"dashed",on:1,off:3}),
e.textline(c,u,q,u,x,n.gridStyle)):(e.textline(c,u,q-2,u,q+2),e.textline(c,u,x-2,u,x+2)),O))if(U){if(A=null,D?u>z&&(A=a.sec2tod(B,!0),z=u+c.text_w*(A.length+1)):(A=e.format_f(B*N,R,R/2),A=E(A,!0)),A){var w=Math.round(A.length/2)*c.text_w;n.inside&&(u=Math.max(p+w,u),u=Math.min(t-w,u));0<=u-w&&e.text(c,u-w,l,A)}}else B===H.dtic1&&(D?(A=a.sec2tod(B,!0),n.inside&&(u=Math.floor(Math.max(p+k,u))),e.text(c,u-k,l,A+" +\u0394 "+a.sec2tod(H.dtic))):(A=(H.dtic1*N).toString(),n.inside&&(u=Math.floor(Math.max(p+
k,u))),e.text(c,u-k,l,A+" +\u0394 "+H.dtic*N)));k=n.yonright?n.inside?Math.min(t-6*c.text_w,c.width-5*c.text_w):Math.min(t+c.text_w,c.width-5*c.text_w):n.inside?Math.max(0,p+c.text_w):Math.max(0,Math.floor(p-(c.l-0.5)*c.text_w));l=0.4*c.text_h;s=h.ymin!==h.ymax?-C/(h.ymax-h.ymin):-C/1;N=0!==f?1/f:1;C=h.ymax>=h.ymin?function(a){return a<=h.ymax}:function(a){return a>=h.ymax};for(H=J.dtic1;C(H);H+=J.dtic)u=q+Math.round(s*(H-h.ymin))-2,u>q||(n.grid&&"x"!==n.grid?(n.gridStyle||(n.gridStyle={mode:"dashed",
on:1,off:3}),e.textline(c,p,u,t,u,n.gridStyle)):(e.textline(c,p-2,u,p+2,u),e.textline(c,t-2,u,t+2,u)),!g||n.inside&&(u<x+c.text_h||u>q-2*c.text_h)||(r?(D=a.sec2tod(H),f=u+l-c.text_h,O=D.indexOf("::"),-1!==O&&(f>x&&f<q&&e.text(c,k,f,D.substring(0,O)),O+=1),e.text(c,k,Math.min(q,u+l),D.substring(O+1,O+6)),f=u+l+c.text_h,f>x&&f<q&&"00"!==D.substring(O+7,O+9)&&(D+=".00",e.text(c,k,f,D.substring(O+7,O+12)))):(D=e.format_f(H*N,12,6),D=E(D,n.inside),e.text(c,k,Math.min(q,u+l),D))))};e.inrect=function(a,
d,e,f,g,k){return a>=e&&a<=e+g&&d>=f&&d<=f+k};var F={GBorder:3,sidelab:0,toplab:1};e.menu=function(a,f){var h=1.5*a.text_h;if(f){if(!a.widget){f.x=a.xpos;f.y=a.ypos;f.val=0;f.h=2*F.GBorder+h*f.items.length+F.toplab*(h+F.GBorder)-1;f.y=f.y-((F.toplab+Math.max(1,f.val)-0.5)*h+(1+F.toplab)*F.GBorder)+1;for(var p=f.title.length,t=0,n=0;n<f.items.length;n++){var u=f.items[n],p=Math.max(p,u.text.length);"checkbox"===u.style&&(p+=2);"separator"===u.style&&(p+=2);u.checked&&"checkbox"!==u.style&&(t=h*n)}f.y-=
t;p=(p+2)*a.text_w;f.w=2*F.GBorder+Math.abs(F.sidelab)+p-1;f.x-=f.w/2;a.menu=f;a.widget={type:"MENU",callback:function(h){var n=f;if(h===d)l(a,n);else if("mousemove"===h.type){n.drag_x!==d&&n.drag_y!==d&&2<Math.abs(a.xpos-n.drag_x)&&2<Math.abs(a.ypos-n.drag_y)&&(n.x+=a.xpos-n.drag_x,n.y+=a.ypos-n.drag_y,n.drag_x=a.xpos,n.drag_y=a.ypos);var p=n.x+F.GBorder+Math.max(0,F.sidelab),q=n.w-2*F.GBorder-Math.abs(F.sidelab),s=1.5*a.text_h,C=n.y+F.GBorder+F.toplab*(s+F.GBorder);for(h=0;h<n.items.length;h++){var r=
C+s*h,D=n.items[h];D.selected=!1;e.inrect(a.xpos,a.ypos,p,r,q,s)&&(D.selected=!0)}l(a,n)}else if("mouseup"===h.type)n.drag_x=d,n.drag_y=d;else if("mousedown"===h.type)h.preventDefault(),1===h.which?a.xpos>n.x&&a.xpos<n.x+n.w&&a.ypos>n.y&&a.ypos<n.y+1.5*a.text_h?(n.drag_x=a.xpos,n.drag_y=a.ypos):g(a,n):k(a,n);else if("keydown"===h.type&&a.menu)if(n=a.menu,h.preventDefault(),h=getKeyCode(h),13===h)g(a,n);else if(38===h){for(h=0;h<n.items.length;h++)if(D=n.items[h],D.selected){D.selected=!1;n.items[h-
1]!==d&&(n.items[h-1].selected=!0);break}else h===n.items.length-1&&(D.selected=!0);l(a,n)}else if(40===h){for(h=0;h<n.items.length;h++)if(D=n.items[h],D.selected){D.selected=!1;n.items[h+1]!==d&&(n.items[h+1].selected=!0);break}else h===n.items.length-1&&(n.items[0].selected=!0);l(a,n)}else if(48<=h&&57>=h||65<=h&&90>=h){h=String.fromCharCode(h).toUpperCase();n.keypresses=n.keypresses===d?h:n.keypresses+h;for(h=p=0;h<n.items.length;h++)D=n.items[h],D.selected=!1,D.text&&0===D.text.toUpperCase().indexOf(n.keypresses)&&
(0===p&&(D.selected=!0),p++);0===p?(n.keypresses=d,l(a,n)):1===p?g(a,n):l(a,n)}}}}l(a,f)}};e.widgetbox=function(a,d,f,g,h,n,k,l,p,t){e.shadowbox(a,d,f,g,h,1,2,"",0.75);t&&(h=t.length,h=Math.min(h,g/a.text_w),h=Math.max(h,1),d+=(g-h*a.text_w)/2,f+=3,e.text(a,d,f+(k-f+0.7*a.text_h)/2,t,a.xwfg));0<l&&0<p&&(f=a.active_canvas.getContext("2d"),e.LEGACY_RENDER?(f.fillStyle=a.bg,f.fillRect(n,k,l,p)):(f.save(),f.globalAlpha=0.1,f.fillStyle=a.bg,f.fillRect(n,k,l,p),f.restore()))};e.text=function(a,e,f,g,h){var n=
a.active_canvas.getContext("2d");e=Math.max(0,e);f=Math.max(0,f);if(0>e||0>f)throw"On No!";n.textBaseline="bottom";n.textAlign="left";n.font=a.font.font;n.fillStyle=h===d?a.fg:h;n.fillText(g,e,f)};e.getcolor=function(a,d,e){for(a=0;6>a&&0===d[a+1].pos;a++);for(;e>d[a].pos&&6>a;)a++;if(0===a||e>=d[a].pos)return A(z(d[a].red),z(d[a].green),z(d[a].blue));e=z((e-d[a-1].pos)/(d[a].pos-d[a-1].pos)*100);var f=255-e;return A(d[a].red/100*e+d[a-1].red/100*f,d[a].green/100*e+d[a-1].green/100*f,d[a].blue/100*
e+d[a-1].blue/100*f)};e.redraw_warpbox=function(a){a.warpbox&&(a._animationFrameHandle&&cancelAnimFrame(a._animationFrameHandle),a._animationFrameHandle=requestAnimFrame(function(){I(a)}))};e.format_g=function(a,d,f,g){Math.min(d,f+7);d=Math.abs(a).toString();var h=d.indexOf(".");-1===h&&(d+=".",h=d.length);g=0;var n=d.indexOf("e");-1!==n&&(g=parseInt(d.slice(n+1,d.length),10),d=d.slice(0,n));for(var n=Math.min(f-(d.length-h)+1,f),k=0;k<n;k++)d+="0";if(0!==a)if(1>Math.abs(a))if("0."===d.slice(0,2))for(k=
2;k<d.length;k++)if("0"===d[k])g-=1;else{d="0."+d.slice(k,k+f);break}else d=d.slice(0,f+2);else h>f?(g=Math.max(0,h-1),d=d[0]+"."+d.slice(1,f+1)):d=d.slice(0,f+2);0===g?d+="    ":(f=e.pad(Math.abs(g).toString(),2,"0"),d=0>g?d+"E-"+f:d+"E+"+f);return 0>a?"-"+d:" "+d};e.format_f=function(a,d,f){f=Math.max(Math.min(f,20),0);a=a.toFixed(f).toString();return a=e.pad(a,d+f," ")};e.pad=function(a,d,e){for(;a.length<d;)a=e+a;return a};e.legacy_shadowbox=function(c,d,f,g,h,n,k,l){for(var p=l.length,u=0,q=
0,u=0,q=[],s=0;11>s;s++)q[s]={x:0,y:0};s=!(1===k||-1===k);0!==k&&0<e.GBorder&&(u=a.trunc(Math.min(g,h)/3),u=Math.max(1,Math.min(u,e.GBorder)));if(0<u){q[0].x=q[1].x=d;q[8].x=q[9].x=d+g;q[1].y=q[8].y=f;q[0].y=q[9].y=f+h;switch(n){case e.L_ArrowLeft:q[0].y=q[1].y=f+a.trunc(h/2);d+=2;--g;break;case e.L_ArrowRight:q[8].y=q[9].y=f+a.trunc(h/2);--d;--g;break;case e.L_ArrowUp:q[1].x=q[8].x=d+a.trunc(g/2);f+=2;--h;break;case e.L_ArrowDown:q[0].x=q[9].x=d+a.trunc(g/2),--f,--h}q[2]=q[8];q[10]=q[0];d+=u;f+=
u;g-=2*u;h-=2*u}q[4].x=q[5].x=d;q[3].x=q[6].x=d+g;q[3].y=q[4].y=f;q[5].y=q[6].y=f+h;switch(n){case e.L_ArrowLeft:q[4].y=q[5].y=f+a.trunc(h/2);break;case e.L_ArrowRight:q[3].y=q[6].y=f+a.trunc(h/2);break;case e.L_ArrowUp:q[3].x=q[4].x=d+a.trunc(g/2);break;case e.L_ArrowDown:q[5].x=q[6].x=d+a.trunc(g/2)}q[7]=q[3];n=c.active_canvas.getContext("2d");0<u&&(n.fillStyle=0<k?c.xwts:c.xwbs,t(n,q.slice(0,7)),n.fillStyle=0>k?c.xwts:c.xwbs,t(n,q.slice(5,11)));s&&(n.fillStyle=c.xwbg,t(n,q.slice(3,8)));n.fillStyle=
c.xwfg;n.textBaseline="alphabetic";s&&0<p&&(p=Math.min(p,a.trunc(g/c.text_w)),p=Math.max(p,1),u=d+a.trunc((g-p*c.text_w)/2),q=f+a.trunc((h+0.7*c.text_h)/2),n.fillText(l,u,q))};e.sigplot_shadowbox=function(c,d,f,g,h,n,k,l,p){var u=c.active_canvas.getContext("2d"),q=l.length,s=0>k?c.xwts:c.xwbs;p=p||1;for(var C=[],r=0;11>r;r++)C[r]={x:0,y:0};switch(n){case e.L_ArrowLeft:case e.L_ArrowRight:case e.L_ArrowUp:case e.L_ArrowDown:C=e.chevron(n,d,f,g,h);u.fillStyle=0<k?c.xwts:c.xwbs;t(u,C.slice(0,6));break;
default:e.draw_round_box(c,s,d,f,g,h,p,c.xwbg,5,c.xwbs)}u.fillStyle=c.xwfg;u.textBaseline="alphabetic";1!==k&&-1!==k&&0<q&&(q=Math.min(q,a.trunc(g/c.text_w)),q=Math.max(q,1),d+=a.trunc((g-q*c.text_w)/2),c=f+a.trunc((h+0.7*c.text_h)/2),u.fillText(l,d,c))};e.shadowbox=e.LEGACY_RENDER?e.legacy_shadowbox:e.sigplot_shadowbox;e.chevron=function(c,d,f,g,h,n){var k=Math.min(g,h);n||(n=0.25*k);for(var l=[],p=0;6>p;p++)l[p]={x:0,y:0};var p=a.trunc((g-k)/2+k/4-n/2.828),t=a.trunc((h-k)/2+k/4-n/2.828);switch(c){case e.L_ArrowLeft:l[0].x=
d+p;l[0].y=f+a.trunc(k/2);l[1].x=d+p+a.trunc(k/2);l[1].y=f;l[2].x=d+p+a.trunc(k/2+n/1.414);l[2].y=f+a.trunc(n/1.414);l[3].x=d+p+a.trunc(2*n/1.414);l[3].y=f+a.trunc(k/2);l[4].x=d+p+a.trunc(k/2+n/1.414);l[4].y=f+h-a.trunc(n/1.414);l[5].x=d+p+a.trunc(k/2);l[5].y=f+k;break;case e.L_ArrowRight:l[0].x=d+g-p;l[0].y=f+a.trunc(k/2);l[1].x=d+g-p-a.trunc(k/2);l[1].y=f;l[2].x=d+g-p-a.trunc(k/2+n/1.414);l[2].y=f+a.trunc(n/1.414);l[3].x=d+g-p-a.trunc(2*n/1.414);l[3].y=f+a.trunc(k/2);l[4].x=d+g-p-a.trunc(k/2+n/
1.414);l[4].y=f+h-a.trunc(n/1.414);l[5].x=d+g-p-a.trunc(k/2);l[5].y=f+k;break;case e.L_ArrowUp:l[0].x=d+a.trunc(k/2);l[0].y=f+t;l[1].x=d;l[1].y=f+t+a.trunc(k/2);l[2].x=d+a.trunc(n/1.414);l[2].y=f+t+a.trunc(k/2+n/1.414);l[3].x=d+a.trunc(k/2);l[3].y=f+t+a.trunc(2*n/1.414);l[4].x=d+g-a.trunc(n/1.414);l[4].y=f+t+a.trunc(k/2+n/1.414);l[5].x=d+k;l[5].y=f+t+a.trunc(k/2);break;case e.L_ArrowDown:l[0].x=d+a.trunc(k/2),l[0].y=f+h-t,l[1].x=d,l[1].y=f+h-t-a.trunc(k/2),l[2].x=d+a.trunc(n/1.414),l[2].y=f+h-t-a.trunc(k/
2+n/1.414),l[3].x=d+a.trunc(k/2),l[3].y=f+h-t-a.trunc(2*n/1.414),l[4].x=d+g-a.trunc(n/1.414),l[4].y=f+h-t-a.trunc(k/2+n/1.414),l[5].x=d+k,l[5].y=f+h-t-a.trunc(k/2)}return l};e.ifevent=function(a,e){a.button_press=0;a.button_release=0;a.state_mask=0;var f=e.target.getBoundingClientRect(),g=e.offsetX===d?e.pageX-f.left-window.scrollX:e.offsetX,f=e.offsetX===d?e.pageY-f.top-window.scrollY:e.offsetY;switch(e.type){case "mousedown":a.xpos=P(g,0,a.width);a.ypos=P(f,0,a.height);switch(e.which){case 1:a.button_press=
1;break;case 2:a.button_press=2;break;case 3:a.button_press=3;break;case 4:a.button_press=4;break;case 5:a.button_press=5}break;case "mouseup":switch(a.xpos=P(g,0,a.width),a.ypos=P(f,0,a.height),e.which){case 1:a.button_release=1;break;case 2:a.button_release=2;break;case 3:a.button_release=3;break;case 4:a.button_release=4;break;case 5:a.button_release=5}}};e.scroll_real2pix=function(a){if(0===a.range)return{s1:a.a1,sw:a.a2-a.a1};var d,e;d=(a.a2-a.a1)/a.trange;e=a.a1+Math.floor(0.5+(a.smin-a.tmin)*
d);d=e+Math.floor(0.5+a.srange*d);e=e>a.a2-a.swmin?a.a2-a.swmin:Math.max(e,a.a1);d=d<a.a1+a.swmin?a.a1+a.swmin:Math.min(d,a.a2);return{s1:e,sw:Math.max(d-e,a.swmin)}};e.redrawScrollbar=function(c,d,f){var g,h,k,l,p,t,u,q,s=d.active_canvas.getContext("2d");h=e.scroll_real2pix(c);u=h.s1;q=h.sw;t=u;h=c.x;k=c.y;l=c.w;p=c.h;c.origin&1?(g=k+p/2,c.origin&2&&(t=l-t-q),f===e.XW_DRAW&&(f=c.arrow,e.shadowbox(d,h,k,f,p-1,e.L_ArrowLeft,2,"",0),e.shadowbox(d,h+l-f,k,f-1,p,e.L_ArrowRight,2,"",0)),e.LEGACY_RENDER?
(e.draw_line(d,d.fg,h+c.a1,g,h+c.a2,g),e.shadowbox(d,h+t,k,q+1,p,1,2,"",0)):(f=s.createLinearGradient(h+c.a1,0,h+c.a2,0),f.addColorStop(0,d.xwbs),f.addColorStop(0.5,d.xwts),f.addColorStop(1,d.xwbs),e.draw_line(d,f,h+c.a1,g,h+c.a2,g,1),f=s.createLinearGradient(0,k,0,k+p),f.addColorStop(0.1,d.xwts),f.addColorStop(0.75,d.xwbs),e.draw_round_box(d,d.xwbg,h+t,k,q+1,p,1,f,8,d.xwbs))):(g=h+a.trunc(l/2),2>=c.origin&&(t=p-t-q),f===e.XW_DRAW&&(f=c.arrow,e.shadowbox(d,h,k,l-1,f,e.L_ArrowUp,2,"",0),e.shadowbox(d,
h,k+p-f,l-1,f,e.L_ArrowDown,2,"",0)),e.LEGACY_RENDER?(e.draw_line(d,d.fg,g,k+c.a1,g,k+c.a2),e.shadowbox(d,h,k+t,l,q+1,1,2,"",0)):(f=s.createLinearGradient(0,k+c.a1,0,k+c.a2),f.addColorStop(0,d.xwbs),f.addColorStop(0.5,d.xwts),f.addColorStop(1,d.xwbs),e.draw_line(d,f,g,k+c.a1,g,k+c.a2,1),f=s.createLinearGradient(h,0,h+l,0),f.addColorStop(0.1,d.xwts),f.addColorStop(0.75,d.xwbs),e.draw_round_box(d,d.xwbg,h-1,k+t,l,q+1,1,f,8,d.xwbs)));c.s1=u;c.sw=q};e.real_to_pixel=function(a,d,f,g){a=e.origin(a.origin,
4,a.stk[a.level]);if(0===a.xscl||0===a.yscl)return{x:0,y:0};var h=a.x1,k=a.y1,l=a.xmin,p=1/a.xscl,t=a.ymin,u=1/a.yscl,q=!1,s=!1;null!==d&&(q=d>a.xmax||d<a.xmin,g&&(d=Math.min(d,a.xmax),d=Math.max(d,a.xmin)),d=Math.round((d-l)*p)+h);null!==f&&(s=f>a.ymin||f<a.ymax,g&&(f=Math.min(f,a.ymin),f=Math.max(f,a.ymax)),f=Math.round((f-t)*u)+k);d=Math.round(d);f=Math.round(f);return{x:d,y:f,clipped_x:q,clipped_y:s,clipped:q||s}};e.pixel_to_real=function(a,d,e){d=Math.min(a.r,Math.max(a.l,d));e=Math.min(a.b,
Math.max(a.t,e));var f=a.level;return{x:2!==a.origin&&3!==a.origin?a.stk[f].xmin+(d-a.stk[f].x1)*a.stk[f].xscl:a.stk[f].xmin+(a.stk[f].x2-d)*a.stk[f].xscl,y:2<a.origin?a.stk[f].ymin+(e-a.stk[f].y1)*a.stk[f].yscl:a.stk[f].ymin+(a.stk[f].y2-e)*a.stk[f].yscl}};e.colormap=function(a,d,e){a.pixel=Array(e);for(var f=Array(e),g=100/(Math.max(2,e)-1),h=0;h<e;h++)f[h]=g*h+0.5;for(g=0;6>g&&0===d[g+1].pos;g++);for(h=0;h<e;h++){a.pixel[h]=0;for(var k=f[h];6>g&&Math.floor(k)>d[g].pos;)g++;if(0===g||k>=d[g].pos)a.pixel[h]=
{red:z(d[g].red),green:z(d[g].green),blue:z(d[g].blue)};else{var k=z((k-d[g-1].pos)/(d[g].pos-d[g-1].pos)*100),l=255-k;a.pixel[h]={red:d[g].red/100*k+d[g-1].red/100*l,green:d[g].green/100*k+d[g-1].green/100*l,blue:d[g].blue/100*k+d[g-1].blue/100*l}}}};e.colorbar=function(a,d,f,g,h){for(var k=1;k<h;k++)e.draw_line(a,Math.floor(a.pixel.length*(k-1)/h),d,f+h-k,d+g,f+h-k);e.draw_box(a,a.fg,d+0.5,f,g,h)};var V="undefined"===typeof Uint8ClampedArray?L:Q;e.shift_image_rows=function(a,d,e){a=new Uint32Array(d);
0<e?(e*=d.width,a.set(a.subarray(0,a.length-e),e)):0>e&&(e=Math.abs(e)*d.width,a.set(a.subarray(e)));return d};e.update_image_row=function(a,d,e,f,g,h){f=new Uint32Array(d,f*d.width*4,d.width);var k=1;h!==g&&(k=a.pixel.length/Math.abs(h-g));for(h=0;h<e.length;h++){var l=Math.floor((e[h]-g)*k),l=Math.max(0,Math.min(a.pixel.length-1,l));(l=a.pixel[l])&&(f[h]=-16777216|l.blue<<16|l.green<<8|l.red)}return d};e.create_image=function(d,f,g,h,k,l){d.active_canvas.getContext("2d");d.pixel&&0!==d.pixel.length||
(a.log.warn("COLORMAP not initialized, defaulting to foreground"),e.colormap(d,a.Mc.colormap[1].colors,16));var p=1;l!==k&&(p=d.pixel.length/Math.abs(l-k));g=Math.ceil(g);h=Math.ceil(h);l=new ArrayBuffer(g*h*4);l.width=g;l.height=h;for(var t=new Uint32Array(l),u=0;u<t.length;u++){var B=Math.floor((f[(3===d.origin||4===d.origin?Math.floor(u/g):h-Math.floor(u/g)-1)*g+(1===d.origin||4===d.origin?Math.floor(u%g):g-Math.floor(u%g)-1)]-k)*p),B=Math.max(0,Math.min(d.pixel.length-1,B));(B=d.pixel[B])&&(t[u]=
-16777216|B.blue<<16|B.green<<8|B.red)}return l};e.put_image=function(d,f,g,h,k,l,p,t,u,B,q){u=d.active_canvas.getContext("2d");d.pixel&&0!==d.pixel.length||(a.log.warn("COLORMAP not initialized, defaulting to foreground"),e.colormap(d,a.Mc.colormap[1].colors,16));g=Math.floor(0<k?g*k:-k);h=Math.floor(h*l);l=new ArrayBuffer(g*h*4);l.width=g;l.height=h;k=new Uint32Array(l);for(var s=0;s<k.length;s++){var C=Math.max(0,f[s]),C=Math.min(d.pixel.length-1,C);(C=d.pixel[C])&&(k[s]=-16777216|C.blue<<16|C.green<<
8|C.red)}V(d,u,l,B,q,p,t,g,h);return l};e.draw_image=function(a,d,f,g,h,k,l,p){var t=Math.max(f,a.stk[a.level].xmin),u=Math.min(h,a.stk[a.level].xmax),q=Math.max(g,a.stk[a.level].ymin),s=Math.min(k,a.stk[a.level].ymax);if(!(1>=d.width||0===Math.abs(h-f)||1>=d.height||0===Math.abs(k-g))){h=d.width/(h-f);var C=d.height/(k-g),t=Math.floor(t*h)/h,u=Math.ceil(u*h)/h,q=Math.floor(q*C)/C,s=Math.ceil(s*C)/C,r,D,H,J,N,B;1===a.origin?(H=Math.max(0,Math.floor((k-s)*C)),B=Math.min(d.height-H,Math.floor((s-q)*
C)),J=Math.max(0,Math.floor((t-f)*h)),N=Math.min(d.width-J,Math.floor((u-t)*h)),r=e.real_to_pixel(a,t,s),D=e.real_to_pixel(a,u,q)):2===a.origin?(H=Math.max(0,Math.floor((k-s)*C)),B=Math.min(d.height-H,Math.floor((s-q)*C)),J=Math.max(0,Math.ceil((t-f)*h)),N=Math.min(d.width-J,Math.floor((u-t)*h)),r=e.real_to_pixel(a,u,s),D=e.real_to_pixel(a,t,q)):3===a.origin?(H=Math.max(0,Math.ceil((q-g)*C)),B=Math.min(d.height-H,Math.floor((s-q)*C)),J=Math.max(0,Math.ceil((t-f)*h)),N=Math.min(d.width-J,Math.floor((u-
t)*h)),r=e.real_to_pixel(a,u,q),D=e.real_to_pixel(a,t,s)):4===a.origin&&(H=Math.max(0,Math.ceil((q-g)*C)),B=Math.min(d.height-H,Math.floor((s-q)*C)),J=Math.max(0,Math.floor((t-f)*h)),N=Math.min(d.width-J,Math.floor((u-t)*h)),r=e.real_to_pixel(a,t,q),D=e.real_to_pixel(a,u,s));f=D.x-r.x;D=D.y-r.y;N=Math.max(1,N);B=Math.max(1,B);"number"===typeof p&&(p=(a.r-a.l)/N<=p);g=a.active_canvas.getContext("2d");g.save();g.beginPath();g.rect(a.l,a.t,a.r-a.l,a.b-a.t);g.clip();V(a,g,d,l,p,r.x,r.y,f,D,J,H,N,B);g.restore()}}})(window.mx,
window.m);
(function(e,a,d,w){e.Layer1D=function(a){this.plot=a;this.ybuf=this.xbuf=w;this.xmax=this.xmin=this.imin=this.xdelta=this.xstart=this.offset=0;this.name="";this.cx=!1;this.hcb=w;this.size=0;this.display=!0;this.color=0;this.line=3;this.thick=1;this.symbol=0;this.radius=3;this.ysub=this.xsub=this.skip=0;this.modified=this.xdata=!1;this.preferred_origin=this.opacity=1;this.pointbufsize=0;this.ypoint=this.xpoint=this.yptr=this.xptr=null;this.options={}};e.Layer1D.prototype={init:function(a,l){this.hcb=
a;this.hcb.buf_type="D";this.ybufn=this.xbufn=this.size=this.offset=0;this.hcb.pipe?this.size=l.framesize:2===a["class"]?(d.force1000(a),this.size=a.subsize):this.size=a.size;2>=a["class"]&&(this.xsub=-1,this.ysub=1,this.cx="C"===a.format[0]);this.skip=1;this.cx&&(this.skip=2);this.xstart=a.xstart;this.xdelta=a.xdelta;var g=a.xstart+a.xdelta*(this.size-1);this.xmin=Math.min(a.xstart,g);this.xmax=Math.max(a.xstart,g);this.xlab=a.xunits;this.ylab=a.yunits;if(this.hcb.pipe){this.drawmode="scrolling";
this.position=0;this.tle=l.tl;this.ybufn=this.size*Math.max(this.skip*e.PointArray.BYTES_PER_ELEMENT,e.PointArray.BYTES_PER_ELEMENT);this.ybuf=new ArrayBuffer(this.ybufn);var k=this;d.addPipeWriteListener(this.hcb,function(){k._onpipewrite()})}},_onpipewrite:function(){var a=new e.PointArray(this.ybuf),l=this.tle;if(l===w)l=Math.floor(d.pavail(this.hcb))/this.hcb.spa;else if(d.pavail(this.hcb)<l*this.hcb.spa)return;var g=l*this.hcb.spa;if("lefttoright"===this.drawmode)this.position=0,a.set(a.subarray(0,
this.size-g),g);else if("righttoleft"===this.drawmode)this.position=this.size-l,a.set(a.subarray(g),0);else if("scrolling"!==this.drawmode)throw"Invalid draw mode";l=Math.min(l,this.size-this.position);0!==d.grabx(this.hcb,a,l*this.hcb.spa,this.position*this.hcb.spa)&&(this.position=(this.position+l)%this.size,1<this.plot._Gx.autol&&this.plot.rescale())},get_data:function(a,l){var g=this.plot._Gx,k=this.hcb,h=this.skip,p;p=2===k["class"]?k.subsize:k.size;var t=0,h=0;g.index?(t=Math.floor(a),h=Math.floor(l+
0.5)):0<=k.xdelta?(t=Math.floor((a-k.xstart)/k.xdelta)-1,h=Math.floor((l-k.xstart)/k.xdelta+0.5)):(t=Math.floor((l-k.xstart)/k.xdelta)-1,h=Math.floor((a-k.xstart)/k.xdelta+0.5));t=Math.max(0,t);h=Math.min(p,h);g=Math.max(0,Math.min(h-t+1,g.bufmax));0>k.xdelta&&(t=h-g+1);if(!(t>=this.imin&&t+g<=this.imin+this.size&&this.ybuf!==w||this.modified)&&2>=k["class"]){p=this.offset+t;h=this.skip;this.ybufn=g*Math.max(h*e.PointArray.BYTES_PER_ELEMENT,e.PointArray.BYTES_PER_ELEMENT);if(this.ybuf===w||this.ybuf.byteLength<
this.ybufn)this.ybuf=new ArrayBuffer(this.ybufn);h=new e.PointArray(this.ybuf);g=d.grab(k,h,p,g);this.imin=t;this.xstart=k.xstart+t*this.xdelta;this.size=g}},change_settings:function(a){if(a.index!==w)if(a.index)this.xmin=this.xdelta=this.xstart=1,this.xmax=this.size;else{this.xstart=this.hcb.xstart+this.imin*this.xdelta;this.xdelta=this.hcb.xdelta;var d=this.hcb.xstart+this.hcb.xdelta*(this.size-1);this.xmin=Math.min(this.hcb.xstart,d);this.xmax=Math.max(this.hcb.xstart,d)}a.drawmode!==w&&(this.drawmode=
a.drawmode,this.position=0,this.ybufn=this.size*Math.max(this.skip*e.PointArray.BYTES_PER_ELEMENT,e.PointArray.BYTES_PER_ELEMENT),this.ybuf=new ArrayBuffer(this.ybufn))},reload:function(a,e){if(this.hcb.pipe)throw"reload cannot be used with pipe, use push instead";var g=this.hcb.dview.length!==a.length||e;if(e)for(var k in e)if(this.hcb[k]=e[k],"xstart"===k||"xdelta"===k)g=!0;this.hcb.setData(a);this.imin=0;this.xstart=w;this.size=0;k=this.xmin;var h=this.xmax;g&&(2===this.hcb["class"]&&d.force1000(this.hcb),
g=this.hcb.xstart+this.hcb.xdelta*(this.hcb.size-1),this.xmin=Math.min(this.hcb.xstart,g),this.xmax=Math.max(this.hcb.xstart,g),this.xdelta=this.hcb.xdelta,this.xstart=this.hcb.xstart,h=k=w);return{xmin:k,xmax:h}},push:function(a,l,g){if(l){for(var k in l)this.hcb[k]=l[k],"type"===k&&(this.hcb["class"]=l[k]/1E3);l.subsize&&2===this.hcb["class"]&&(d.force1000(this.hcb),this.size=this.hcb.subsize,this.position=null,this.ybufn=this.size*Math.max(this.skip*e.PointArray.BYTES_PER_ELEMENT,e.PointArray.BYTES_PER_ELEMENT),
this.ybuf=new ArrayBuffer(this.ybufn));k=this.hcb.xstart+this.hcb.xdelta*(this.hcb.size-1);this.xmin=Math.min(this.hcb.xstart,k);this.xmax=Math.max(this.hcb.xstart,k);this.xdelta=this.hcb.xdelta;this.xstart=this.hcb.xstart}d.filad(this.hcb,a,g);return l?!0:!1},prep:function(a,l){var g=this.plot._Gx,k=this.plot._Mx,h=Math.ceil(this.size),p=this.skip;if(0===h)return{num:0,start:0,end:0};h*e.PointArray.BYTES_PER_ELEMENT>this.pointbufsize&&(this.pointbufsize=h*e.PointArray.BYTES_PER_ELEMENT,this.xptr=
new ArrayBuffer(this.pointbufsize),this.yptr=new ArrayBuffer(this.pointbufsize),this.xpoint=new e.PointArray(this.xptr),this.ypoint=new e.PointArray(this.yptr));var t=new e.PointArray(this.ybuf),u=this.xmin,z=this.xmax,A,w,I;if(5===g.cmode||0<this.xsub)0>=h?(u=g.panxmin,z=g.panxmax):5!==g.cmode?this.xpoint=new e.PointArray(this.xbuf):this.cx?d.vmov(t,p,this.xpoint,1,h):0!==this.line?(I=d.vmxmn(t,h),this.xpoint[0]=I.smax,this.xpoint[1]=I.smin,A=0,h=w=2):this.xpoint=t,0<h&&(I=d.vmxmn(this.xpoint,h),
z=I.smax,u=I.smin,A=0,w=h);else if(0<h){I=this.xstart;var P=this.xdelta;w=h;g.index?(A=0,w=h-1):0<=P?(A=Math.max(1,Math.min(w,Math.round((a-I)/P)))-1,w=Math.max(1,Math.min(w,Math.round((l-I)/P)+2))-1):(A=Math.max(1,Math.min(w,Math.round((l-I)/P)-1))-1,w=Math.max(1,Math.min(w,Math.round((a-I)/P)+2))-1);h=w-A+1;0>h&&(d.log.debug("Nothing to plot"),h=0);t=(new e.PointArray(this.ybuf)).subarray(A*p);I+=P*A;for(var L=0;L<h;L++)this.xpoint[L]=g.index?this.imin+L+1:I+L*P}g.panxmin>g.panxmax?(g.panxmin=u,
g.panxmax=z):(g.panxmin=Math.min(g.panxmin,u),g.panxmax=Math.max(g.panxmax,z));if(0>=h)d.log.debug("Nothing to plot");else{if(this.cx)1===g.cmode?d.cvmag(t,this.ypoint,h):2===g.cmode?25===g.plab?(d.cvpha(t,this.ypoint,h),d.vsmul(this.ypoint,1/(2*Math.PI),this.ypoint,h)):24!==g.plab?d.cvpha(t,this.ypoint,h):d.cvphad(t,this.ypoint,h):3===g.cmode?d.vmov(t,p,this.ypoint,1,h):6<=g.cmode?d.cvmag2(t,this.ypoint,h):4<=g.cmode&&d.vmov(t.subarray(1),p,this.ypoint,1,h);else if(5===g.cmode)d.vfill(this.ypoint,
0,h);else if(1===g.cmode||6<=g.cmode)for(L=0;L<h;L++)this.ypoint[L]=Math.abs(t[L]);else for(L=0;L<h;L++)this.ypoint[L]=t[L];6<=g.cmode&&(d.vlog10(this.ypoint,g.dbmin,this.ypoint),u=10,7===g.cmode&&(u=20),0<g.lyr.length&&g.lyr[0].cx&&(u/=2),d.vsmul(this.ypoint,u,this.ypoint));I=d.vmxmn(this.ypoint,h);z=I.smax;u=I.smin;p=z-u;0>p&&(z=u,u=z+p,p=-p);1E-20>=p?(u-=1,z+=1):(u-=0.02*p,z+=0.02*p);0===k.level&&(g.panymin>g.panymax?(g.panymin=u,g.panymax=z):(g.panymin=Math.min(g.panymin,u),g.panymax=Math.max(g.panymax,
z)),1<g.autol&&(u=1/Math.max(g.autol,1),g.panymin=g.panymin*u+k.stk[0].ymin*(1-u),g.panymax=g.panymax*u+k.stk[0].ymax*(1-u)));return{num:h,start:A,end:w}}},draw:function(){var d=this.plot._Mx,l=this.plot._Gx,g=this.color,k=this.symbol,h=this.radius,p=0,t={};t.fillStyle=l.fillStyle;this.options&&(t.highlight=this.options.highlight,t.noclip=this.options.noclip);0===this.line?p=0:(p=1,0<this.thick?p=this.thick:0>this.thick&&(p=Math.abs(this.thick),t.dashed=!0),1===this.line&&(t.vertsym=!0),2===this.line&&
(t.horzsym=!0));var u=l.segment&&5!==l.cmode&&0<this.xsub&&!0,z=this.xdelta,A,w;this.xdata?(A=this.xmin,w=this.xmax):(A=Math.max(this.xmin,d.stk[d.level].xmin),w=Math.min(this.xmax,d.stk[d.level].xmax),A>=w&&(l.panxmin=Math.min(l.panxmin,this.xmin),l.panxmax=Math.max(l.panxmax,this.xmax)));if(!l.all){var I=(l.bufmax-1)*z;-0<=I?w=Math.min(w,A+I):A=Math.max(A,w+I)}if(0!==p||0!==k){for(;A<w;)this.hcb.pipe||this.get_data(A,w),I=this.prep(A,w),0<I.num&&!u&&a.trace(d,g,new e.PointArray(this.xptr),new e.PointArray(this.yptr),
I.num,I.start,1,p,k,h,t),l.all?0===this.size?A=w:l.index?A+=I.num:0<=z?A+=this.size*z:w+=this.size*z:A=w;this.position&&"scrolling"===this.drawmode&&(l=a.real_to_pixel(d,this.position*this.xdelta,0),l.x>d.l&&l.x<d.r&&a.draw_line(d,"white",l.x,d.t,l.x,d.b))}},add_highlight:function(a){this.options.highlight||(this.options.highlight=[]);a instanceof Array?this.options.highlight.push.apply(this.options.highlight,a):this.options.highlight.push(a);this.plot.refresh()},remove_highlight:function(a){if(this.options.highlight){for(var d=
this.options.highlight.length;d--;)a!==this.options.highlight[d]&&a!==this.options.highlight[d].id||this.options.highlight.splice(d,1);this.plot.refresh()}},get_highlights:function(){return this.options.highlight?this.options.highlight.slice(0):[]},clear_highlights:function(){this.options.highlight&&(this.options.highlight=w,this.plot.refresh())}};var p=[0,53,27,80,13,40,67,93,7,60,33,87,20,47,73,100];e.Layer1D.overlay=function(f,l,g){var k=f._Gx,h=f._Mx;2===l["class"]&&d.force1000(l);l.buf_type=
"D";var B=1;2===l["class"]&&0<l.size&&(B=Math.min(l.size/l.subsize,16-k.lyr.length));var t=g.name;delete g.name;for(var u=0;u<B;u++){var z=new e.Layer1D(f);z.init(l,g);z.color=a.getcolor(h,d.Mc.colormap[3].colors,p[k.lyr.length%p.length]);2===l["class"]?(t!==w&&(Array.isArray(t)?z.name=t[u]:(z.name=t,z.name=z.name+"."+a.pad((u+1).toString(),3,"0"))),z.name||(z.name=l.file_name?d.trim_name(l.file_name):"layer_"+k.lyr.length,z.name=z.name+"."+a.pad((u+1).toString(),3,"0")),z.offset=u*l.subsize):(z.name=
t!==w?t:l.file_name?d.trim_name(l.file_name):"layer_"+k.lyr.length,z.offset=0);for(var A in g)z[A]!==w&&(z[A]=g[A]);f.add_layer(z)}}})(window.sigplot=window.sigplot||{},mx,m);
(function(e,a,d,w){e.Layer2D=function(a){this.plot=a;this.xmax=this.xmin=this.imin=this.ydelta=this.ystart=this.xdelta=this.xstart=this.offset=0;this.name="";this.cx=!1;this.hcb=w;this.display=!0;this.color=0;this.line=3;this.thick=1;this.symbol=0;this.radius=3;this.ysub=this.xsub=this.skip=0;this.modified=this.xdata=!1;this.preferred_origin=4;this.opacity=1;this.lpb=w;this.yc=1;this.options={}};e.Layer2D.prototype={init:function(a){var f=this.plot._Gx,l=this.plot._Mx;this.hcb=a;this.hcb.buf_type=
"D";if(this.hcb.pipe){var g=this;this.frame=this.position=0;this.lps=this.hcb.lps||Math.ceil(Math.max(1,l.b-l.t));d.addPipeWriteListener(this.hcb,function(){g._onpipewrite()});this.buf=this.hcb.createArray(null,0,this.lps*this.hcb.subsize*this.hcb.spa);this.zbuf=new e.PointArray(this.lps*this.hcb.subsize)}else this.lps=this.hcb.lps||Math.ceil(a.size);this.ybufn=this.xbufn=this.offset=0;this.drawmode="scrolling";2>=a["class"]&&(this.xsub=-1,this.ysub=1,this.cx="C"===a.format[0]);this.skip=1;this.cx&&
(this.skip=2);f.index?(this.xmin=this.xdelta=this.xstart=1,this.xmax=a.subsize,this.ymin=this.ydelta=this.ystart=1,this.ymax=this.size):(this.xstart=a.xstart,this.xdelta=a.xdelta,f=a.xstart+a.xdelta*(a.subsize-1),this.xmin=Math.min(a.xstart,f),this.xmax=Math.max(a.xstart,f),this.ystart=a.ystart,this.ydelta=a.ydelta,f=a.ystart+a.ydelta*(this.lps-1),this.ymin=Math.min(a.ystart,f),this.ymax=Math.max(a.ystart,f));this.xframe=this.hcb.subsize;this.yframe=this.lps*this.hcb.subsize/this.xframe;0===this.lpb&&
(this.lpb=this.yframe);if(!this.lpb||0>=this.lpb)this.lpb=16;this.lpb=Math.max(1,this.lpb/this.yc)*this.yc;this.xlab=a.xunits;this.ylab=a.yunits},_onpipewrite:function(){var p=this.plot._Gx,f=this.plot._Mx;if(!(d.pavail(this.hcb)<this.hcb.subsize*this.hcb.spa)){"scrolling"!==this.drawmode&&(this.hcb.ystart+=this.hcb.ydelta,this.ystart=this.hcb.ystart,this.ymin=this.hcb.ystart-this.hcb.ydelta*this.lps,this.ymax=this.hcb.ystart);if("falling"===this.drawmode)this.position=0,this.buf.set(this.buf.subarray(0,
(this.lps-1)*this.hcb.subsize*this.hcb.spa),this.hcb.subsize*this.hcb.spa),this.img&&a.shift_image_rows(f,this.img,1);else if("rising"===this.drawmode)this.position=this.lps-1,this.buf.set(this.buf.subarray(this.hcb.subsize*this.hcb.spa),0),this.img&&a.shift_image_rows(f,this.img,-1);else if("scrolling"===this.drawmode)this.position>=this.lps&&(this.position=0);else throw"Invalid draw mode";if(0===d.grabx(this.hcb,this.buf,this.hcb.subsize*this.hcb.spa,this.position*this.hcb.subsize*this.hcb.spa))d.log.error("Internal error");
else{var l=this.buf.subarray(this.position*this.hcb.subsize*this.hcb.spa,(this.position+1)*this.hcb.subsize*this.hcb.spa),g=new e.PointArray(this.hcb.subsize);this.cx?1===p.cmode?d.cvmag(l,g,g.length):2===p.cmode?25===p.plab?(d.cvpha(l,g,g.length),d.vsmul(g,1/(2*Math.PI),g,g.length)):24!==p.plab?d.cvpha(l,g,g.length):d.cvphad(l,g,g.length):3===p.cmode?d.vmov(l,this.skip,g,1,g.length):4===p.cmode?d.vmov(l.subarray(1),this.skip,g,1,g.length):5===p.cmode?d.vfill(g,0,g.length):6===p.cmode?d.cvmag2logscale(l,
p.dbmin,10,g):7===p.cmode&&d.cvmag2logscale(l,p.dbmin,20,g):1===p.cmode?d.vabs(l,g):2===p.cmode?d.vfill(g,0,g.length):3===p.cmode?d.vmov(l,this.skip,g,1,g.length):4===p.cmode?d.vfill(g,0,g.length):5===p.cmode?d.vfill(g,0,g.length):6===p.cmode?d.vlogscale(l,p.dbmin,10,g):7===p.cmode&&d.vlogscale(l,p.dbmin,20,g);for(var l=g[0],k=g[0],h=0;h<g.length;h++)g[h]<l&&(l=g[h]),g[h]>k&&(k=g[h]);var w,t;1===p.autol?(w=l,t=k):1<p.autol&&(t=1/Math.max(p.autol,1),w=p.zmin*t+l*(1-t),t=p.zmax*t+k*(1-t));0!==(p.autoz&
1)&&(p.zmin=w);0!==(p.autoz&2)&&(p.zmax=t);this.img&&a.update_image_row(f,this.img,g,this.position,p.zmin,p.zmax);this.frame+=1;"scrolling"===this.drawmode&&(this.position=(this.position+1)%this.lps);0===f.level&&(p.panymin=this.ymin,p.panymax=this.ymax,f.stk[0].ymin=this.ymin,f.stk[0].ymax=this.ymax)}}},get_data:function(){var a=this.hcb;this.buf||(this.buf=this.hcb.createArray(null,0,this.lps*this.hcb.subsize*this.hcb.spa),this.zbuf=new e.PointArray(this.lps*this.hcb.subsize));this.hcb.pipe||d.grab(a,
this.buf,0,a.subsize)},get_z:function(a,d){return this.zbuf[Math.floor(d/this.hcb.ydelta)*this.hcb.subsize+Math.floor(a/this.hcb.xdelta)]},change_settings:function(a){var d=this.plot._Gx;a.cmode!==w&&(this.img=w,0!==(d.autoz&1)&&(d.zmin=w),0!==(d.autoz&2)&&(d.zmax=w));if(a.zmin!==w||a.zmax!==w||a.autoz!==w)this.img=w;a.cmap!==w&&(this.img=w);a.drawmode!==w&&(this.drawmode=a.drawmode,this.frame=this.position=0,this.buf=this.hcb.createArray(null,0,this.lps*this.hcb.subsize*this.hcb.spa),this.zbuf=new e.PointArray(this.lps*
this.hcb.subsize),this.img=w,this.preferred_origin="falling"===this.drawmode?this.plot._Mx.origin=1:this.plot._Mx.origin=4)},push:function(a,f,l){var g=!1,k=null;if(f){f.timestamp&&(k=f.timestamp,delete f.timestamp);f.subsize&&f.subsize!==this.hcb.subsize&&(this.hcb.subsize=f.subsize,this.buf=this.hcb.createArray(null,0,this.lps*this.hcb.subsize*this.hcb.spa),this.zbuf=new e.PointArray(this.lps*this.hcb.subsize),g=!0);for(var h in f)this.hcb[h]!==f[h]&&(this.hcb[h]=f[h],"type"===h&&(this.hcb["class"]=
f[h]/1E3),g=!0);f.lps&&(this.lps=f.lps);g&&(f=this.hcb.xstart+this.hcb.xdelta*(this.hcb.subsize-1),this.xmin=Math.min(this.hcb.xstart,f),this.xmax=Math.max(this.hcb.xstart,f),this.xdelta=this.hcb.xdelta,this.xstart=this.hcb.xstart,this.ystart=this.hcb.ystart,this.ydelta=this.hcb.ydelta,f=this.hcb.ystart+this.hcb.ydelta*(this.lps-1),this.ymin=Math.min(this.hcb.ystart,f),this.ymax=Math.max(this.hcb.ystart,f))}1!==this.hcb.yunits&&4!==this.hcb.yunits||this.hcb.timecode||!k||(this.hcb.timecode=d.j1970toj1950(k),
this.hcb.ystart=0,g=!0);d.filad(this.hcb,a,l);return g},prep:function(e,f){var l=this.plot._Gx,g=this.plot._Mx,k=this.lps,h=this.xmin,B=this.xmax,t;this.get_data(e,f);if(!(5===l.cmode||0<this.xsub)&&0<k){var u=this.xstart,z=this.xdelta,A=k;l.index?(t=0,k-=1):0<=z?(t=Math.max(1,Math.min(A,Math.round((e-u)/z)))-1,k=Math.max(1,Math.min(A,Math.round((f-u)/z)+2))-1):(t=Math.max(1,Math.min(A,Math.round((f-u)/z)-1))-1,k=Math.max(1,Math.min(A,Math.round((e-u)/z)+2))-1);k=k-t+1;0>k&&(d.log.debug("Nothing to plot"),
k=0)}l.panxmin>l.panxmax?(l.panxmin=h,l.panxmax=B):(l.panxmin=Math.min(l.panxmin,h),l.panxmax=Math.max(l.panxmax,B));if(0>=k)d.log.debug("Nothing to plot");else{!(5===l.cmode||0<this.ysub)&&0<k&&(h=this.ystart,B=this.ydelta,A=k,l.index?(t=0,k-=1):0<=B?(t=Math.max(1,Math.min(A,Math.round((e-h)/B)))-1,k=Math.max(1,Math.min(A,Math.round((f-h)/B)+2))-1):(t=Math.max(1,Math.min(A,Math.round((f-h)/B)-1))-1,k=Math.max(1,Math.min(A,Math.round((e-h)/B)+2))-1),k=k-t+1,0>k&&(d.log.debug("Nothing to plot"),k=
0));l.panymin>l.panxmax?(l.panymin=this.ymin,l.panymax=this.ymax):(l.panymin=Math.min(l.panymin,this.ymin),l.panymax=Math.max(l.panymax,this.ymax));this.cx?1===l.cmode?d.cvmag(this.buf,this.zbuf,this.zbuf.length):2===l.cmode?25===l.plab?(d.cvpha(this.buf,this.zbuf,this.zbuf.length),d.vsmul(this.zbuf,1/(2*Math.PI),this.zbuf,this.zbuf.length)):24!==l.plab?d.cvpha(this.buf,this.zbuf,this.zbuf.length):d.cvphad(this.buf,this.zbuf,this.zbuf.length):3===l.cmode?d.vmov(this.buf,this.skip,this.zbuf,1,this.zbuf.length):
4===l.cmode?d.vmov(this.buf.subarray(1),this.skip,this.zbuf,1,this.zbuf.length):5===l.cmode?d.vfill(this.zbuf,0,this.zbuf.length):6===l.cmode?d.cvmag2logscale(this.buf,l.dbmin,10,this.zbuf):7===l.cmode&&d.cvmag2logscale(this.buf,l.dbmin,20,this.zbuf):1===l.cmode?d.vabs(this.buf,this.zbuf):2===l.cmode?d.vfill(this.zbuf,0,this.zbuf.length):3===l.cmode?d.vmov(this.buf,this.skip,this.zbuf,1,this.zbuf.length):4===l.cmode?d.vfill(this.zbuf,0,this.zbuf.length):5===l.cmode?d.vfill(this.zbuf,0,this.zbuf.length):
6===l.cmode?d.vlogscale(this.buf,l.dbmin,10,this.zbuf):7===l.cmode&&d.vlogscale(this.buf,l.dbmin,20,this.zbuf);A=this.zbuf;this.hcb.pipe&&this.frame<this.lps&&(A="rising"===this.drawmode?this.zbuf.subarray(this.zbuf.length-this.frame*this.hcb.subsize):this.zbuf.subarray(0,this.frame*this.hcb.subsize));B=h=0;if(0<A.length)for(h=A[0],B=A[0],t=0;t<A.length&&!(t/this.xframe>=this.lpb);t++)A[t]<h&&(h=A[t]),A[t]>B&&(B=A[t]);0!==(l.autoz&1)&&(l.zmin=l.zmin!==w?Math.min(l.zmin,h):h);0!==(l.autoz&2)&&(l.zmax=
l.zmax!==w?Math.min(l.zmax,B):B);this.img=a.create_image(g,this.zbuf,this.hcb.subsize,this.lps,l.zmin,l.zmax);this.img.cmode=l.cmode;this.img.cmap=l.cmap;this.img.origin=g.origin;if(this.hcb.pipe&&this.frame<this.lps)if(l=new Uint32Array(this.img),"rising"===this.drawmode)for(t=0;t<l.length-this.frame*this.hcb.subsize;t++)l[t]=0;else for(t=this.frame*this.hcb.subsize;t<l.length;t++)l[t]=0;return k}},draw:function(){var d=this.plot._Mx,f=this.plot._Gx,l=this.hcb;if(this.hcb.pipe){var g=this.hcb.lps||
Math.ceil(Math.max(1,d.b-d.t));if(g!==this.lps&&this.buf){var k=this.hcb.createArray(null,0,g*this.hcb.subsize*this.hcb.spa),h=new e.PointArray(g*this.hcb.subsize);k.set(this.buf.subarray(0,k.length));h.set(this.zbuf.subarray(0,h.length));this.buf=k;this.zbuf=h;this.lps=g;this.position>=this.lps&&(this.position=0);g=l.ystart+l.ydelta*(this.lps-1);this.ymin=Math.min(l.ystart,g);this.ymax=Math.max(l.ystart,g);this.plot.rescale()}}g=Math.max(this.xmin,d.stk[d.level].xmin);k=Math.min(this.xmax,d.stk[d.level].xmax);
if(g>=k)f.panxmin=Math.min(f.panxmin,this.xmin),f.panxmax=Math.max(f.panxmax,this.xmax);else{var w=Math.max(this.ymin,d.stk[d.level].ymin),t=Math.min(this.ymax,d.stk[d.level].ymax),h=Math.abs(k-g)+1,u=Math.abs(t-w)+1,h=Math.floor(h/l.xdelta),u=Math.floor(u/l.ydelta),h=Math.min(h,l.subsize),u=Math.min(u,l.size),l=a.real_to_pixel(d,g,w),t=a.real_to_pixel(d,k,t),u=(t.y-l.y)/u;f.xe=Math.max(1,Math.round((t.x-l.x)/h));f.ye=Math.max(1,Math.round(u));this.img?f.cmode===this.img.cmode&&f.cmap===this.img.cmap&&
d.origin===this.img.origin||this.prep(g,k):this.prep(g,k);this.img&&a.draw_image(d,this.img,this.xmin,this.ymin,this.xmax,this.ymax,this.opacity,f.rasterSmoothing);null!==this.position&&"scrolling"===this.drawmode&&(f=a.real_to_pixel(d,0,this.position*this.ydelta),f.y>d.t&&f.y<d.b&&a.draw_line(d,"white",d.l,f.y,d.r,f.y))}}};e.Layer2D.overlay=function(a,f,l){var g=a._Gx;f.buf_type="D";var k=new e.Layer2D(a);k.init(f);k.name=f.file_name?d.trim_name(f.file_name):"layer_"+g.lyr.length;k.change_settings(l);
a.add_layer(k)}})(window.sigplot=window.sigplot||{},mx,m);window.sigplot=window.sigplot||{};
(function(e,a,d){function w(){this.yptr=this.xptr=void 0;this.xmax=this.xmin=this.panymax=this.panymin=this.panxmax=this.panxmin=this.xdelta=this.xstart=this.arety=this.aretx=this.ymrk=this.xmrk=this.rety=this.retx=0;this.xmult=void 0;this.ymax=this.ymin=0;this.zmax=this.zmin=this.ymult=void 0;this.pmt=this.pyscl=this.pxscl=this.dbmin=0;this.format=this.note="";this.modsource=this.modlayer=this.pthk=this.pyl=this.py2=this.py1=this.px2=this.px1=this.pb=this.pt=this.pr=this.pl=0;this.modified=!1;this.ydiv=
this.xdiv=this.modmode=0;this.cross=this.expand=this.all=!1;this.grid=!0;this.gridBackground=void 0;this.index=!1;this.legend=this.specs=this.pan=!0;this.xdata=!1;this.show_readout=this.show_y_axis=this.show_x_axis=!0;this.autohide_panbars=this.autohide_readout=this.hide_note=!1;this.panning=void 0;this.panmode=0;this.hold=!1;this.isec=this.nsec=this.iysec=this.sections=0;this.ylab=this.xlab=void 0;this.default_rubberbox_action="zoom";this.default_rubberbox_mode="box";this.wheelscroll_mode_natural=
!0;this.scroll_time_interval=10;this.stillPanning=this.repeatPanning=void 0;this.autol=-1;this.wheelZoom=this.rasterSmoothing=this.lineSmoothing=!1;this.wheelZoomPercent=0.2;this.inContinuousZoom=!1;this.lyr=[];this.HCB=[];this.plugins=[];this.plotData=document.createElement("canvas");this.plotData.valid=!1}function p(c,e){var f=c._Gx,r=c._Mx;if(Array.isArray(e)){var g={name:"Custom",colors:e};"Custom"===d.Mc.colormap[d.Mc.colormap.length-1].name?d.Mc.colormap[d.Mc.colormap.length-1].colors=e:d.Mc.colormap.push(g);
f.cmap=d.Mc.colormap.length-1}else if("string"===typeof e)for(f.cmap=-1,g=0;g<d.Mc.colormap.length;g++){if(d.Mc.colormap[g].name===e){f.cmap=g;break}}else f.cmap=e;0>f.ncolors&&(f.ncolors*=-1,f.cmap=Math.max(1,f.cmap));if(0>f.cmap||f.cmap>d.Mc.colormap.length)f.cmap=2===f.cmode?2:1;a.colormap(r,d.Mc.colormap[f.cmap].colors,f.ncolors)}function f(d,c){var e=d._Mx;a.removeEventListener(e,"mousedown",d.onmousedown,!1);a.menu(e,{title:"SCROLLBAR",refresh:function(){d.refresh()},finalize:function(){a.addEventListener(e,
"mousedown",d.onmousedown,!1);d.refresh()},items:[{text:"Expand Range",handler:function(){M(d,a.SB_EXPAND,c)}},{text:"Shrink Range",handler:function(){M(d,a.SB_SHRINK,c)}},{text:"Expand Full",handler:function(){M(d,a.SB_FULL,c)}}]})}function l(c){var e=c._Gx,f=c._Mx;a.removeEventListener(f,"mousedown",c.onmousedown,!1);for(var r={text:"Cntrls...",menu:{title:"CONTROLS OPTIONS",items:[{text:"Continuous (Disabled)",checked:-2===e.cntrls,handler:function(){c.change_settings({xcnt:-2})}},{text:"LM Click (Disabled)",
checked:-1===e.cntrls,handler:function(){c.change_settings({xcnt:-1})}},{text:"Off",checked:0===e.cntrls,handler:function(){c.change_settings({xcnt:0})}},{text:"LM Click",checked:1===e.cntrls,handler:function(){c.change_settings({xcnt:1})}},{text:"Continuous",checked:2===e.cntrls,handler:function(){c.change_settings({xcnt:2})}}]}},g={text:"CX Mode...",menu:{title:"COMPLEX MODE",items:[{text:"Magnitude",checked:1===e.cmode,handler:function(){c.change_settings({cmode:1})}},{text:"Phase",checked:2===
e.cmode,handler:function(){c.change_settings({cmode:2})}},{text:"Real",checked:3===e.cmode,handler:function(){c.change_settings({cmode:3})}},{text:"Imaginary",checked:4===e.cmode,handler:function(){c.change_settings({cmode:4})}},{text:"IR: Imag/Real",checked:5===e.cmode,handler:function(){c.change_settings({cmode:5})}},{text:"10*Log10",checked:6===e.cmode,handler:function(){c.change_settings({cmode:6})}},{text:"20*Log10",checked:7===e.cmode,handler:function(){c.change_settings({cmode:7})}}]}},h={text:"Scaling...",
menu:{title:"SCALING",items:[{text:"Y Axis",style:"separator"},{text:"Parameters...",checked:0===e.autoy,handler:function(){e.autoy=0;Q(c,"Y Axis Min:",a.floatValidator,function(a){parseFloat(a)!==f.stk[f.level].ymin?(""===a&&(a=0),n(c,parseFloat(a),f.stk[f.level].ymax,"Y")):c.refresh()},f.stk[f.level].ymin,void 0,void 0,function(){Q(c,"Y Axis Max:",a.floatValidator,function(a){parseFloat(a)!==f.stk[f.level].ymax?(""===a&&(a=0),n(c,f.stk[f.level].ymin,parseFloat(a),"Y")):c.refresh()},f.stk[f.level].ymax,
void 0,void 0,void 0)})}},{text:"Min Auto",checked:1===e.autoy,handler:function(){e.autoy=1}},{text:"Max Auto",checked:2===e.autoy,handler:function(){e.autoy=2}},{text:"Full Auto",checked:3===e.autoy,handler:function(){e.autoy=3}},{text:"X Axis",style:"separator"},{text:"Parameters...",checked:0===e.autox,handler:function(){e.autox=0;Q(c,"X Axis Min:",a.floatValidator,function(a){parseFloat(a)!==f.stk[f.level].xmin?(""===a&&(a=0),n(c,parseFloat(a),f.stk[f.level].xmax,"X")):c.refresh()},f.stk[f.level].xmin,
void 0,void 0,function(){Q(c,"X Axis Max:",a.floatValidator,function(a){parseFloat(a)!==f.stk[f.level].xmax?(""===a&&(a=0),n(c,f.stk[f.level].xmin,parseFloat(a),"X")):c.refresh()},f.stk[f.level].xmax,void 0,void 0,void 0)})}},{text:"Min Auto",checked:1===e.autox,handler:function(){e.autox=1}},{text:"Max Auto",checked:2===e.autox,handler:function(){e.autox=2}},{text:"Full Auto",checked:3===e.autox,handler:function(){e.autox=3}},{text:"Z Axis",style:"separator"},{text:"Parameters...",checked:0===e.autoz,
handler:function(){e.autoz=0;Q(c,"Z Axis Min:",a.floatValidator,function(a){parseFloat(a)!==e.zmin&&(""===a&&(a=0),c.change_settings({zmin:a}))},e.zmin,void 0,void 0,function(){Q(c,"Z Axis Max:",a.floatValidator,function(a){parseFloat(a)!==e.zmax&&(""===a&&(a=0),c.change_settings({zmax:a}))},e.zmax,void 0,void 0,void 0)})}},{text:"Min Auto",checked:1===e.autoz,handler:function(){c.change_settings({autoz:1})}},{text:"Max Auto",checked:2===e.autoz,handler:function(){c.change_settings({autoz:2})}},{text:"Full Auto",
checked:3===e.autoz,handler:function(){c.change_settings({autoz:3})}}]}},k={text:"Settings...",menu:{title:"SETTINGS",items:[{text:"ALL Mode",checked:e.all,style:"checkbox",handler:function(){c.change_settings({all:!e.all})}},{text:"Controls...",menu:{title:"CONTROLS OPTIONS",items:[{text:"Continuous (Disabled)",checked:-2===e.cntrls,handler:function(){c.change_settings({xcnt:-2})}},{text:"LM Click (Disabled)",checked:-1===e.cntrls,handler:function(){c.change_settings({xcnt:-1})}},{text:"Off",checked:0===
e.cntrls,handler:function(){c.change_settings({xcnt:0})}},{text:"LM Click",checked:1===e.cntrls,handler:function(){c.change_settings({xcnt:1})}},{text:"Continuous",checked:2===e.cntrls,handler:function(){c.change_settings({xcnt:2})}}]}},{text:"Mouse...",menu:{title:"MOUSE OPTIONS",items:[{text:"LM Drag (Zoom)",checked:"zoom"===e.default_rubberbox_action,handler:function(){e.default_rubberbox_action="zoom"}},{text:"LM Drag (Select)",checked:"select"===e.default_rubberbox_action,handler:function(){e.default_rubberbox_action=
"select"}},{text:"LM Drag (Disabled)",checked:null===e.default_rubberbox_action,handler:function(){e.default_rubberbox_action=null}},{text:"RM Drag (Zoom)",checked:"zoom"===e.default_rightclick_rubberbox_action,handler:function(){e.default_rightclick_rubberbox_action="zoom"}},{text:"RM Drag (Select)",checked:"select"===e.default_rightclick_rubberbox_action,handler:function(){e.default_rightclick_rubberbox_action="select"}},{text:"RM Drag (Disabled)",checked:null===e.default_rightclick_rubberbox_action,
handler:function(){e.default_rightclick_rubberbox_action=null}},{text:"Mode...",menu:{title:"MOUSE Mode",items:[{text:"Box",checked:"box"===e.default_rubberbox_mode,handler:function(){e.default_rubberbox_mode="box"}},{text:"Horizontal",checked:"horizontal"===e.default_rubberbox_mode,handler:function(){e.default_rubberbox_mode="horizontal"}},{text:"Vertical",checked:"vertical"===e.default_rubberbox_mode,handler:function(){e.default_rubberbox_mode="vertical"}}]}},{text:"CROSShairs...",menu:{title:"Crosshairs Mode",
items:[{text:"Off",checked:!e.cross,handler:function(){e.cross=!1}},{text:"On",checked:!0===e.cross,handler:function(){e.cross=!0}},{text:"Horizontal",checked:"horizontal"===e.cross,handler:function(){e.cross="horizontal"}},{text:"Vertical",checked:"vertical"===e.cross,handler:function(){e.cross="vertical"}}]}},{text:"Mousewheel Natural Mode",checked:e.wheelscroll_mode_natural,style:"checkbox",handler:function(){c.change_settings({wheelscroll_mode_natural:!e.wheelscroll_mode_natural})}}]}},{text:"CROSShairs",
checked:e.cross,style:"checkbox",handler:function(){c.change_settings({cross:!e.cross})}},{text:"GRID",checked:e.grid,style:"checkbox",handler:function(){c.change_settings({grid:!e.grid})}},{text:"INDEX Mode",checked:e.index,style:"checkbox",handler:function(){c.change_settings({index:!e.index})}},{text:"LEGEND",checked:e.legend,style:"checkbox",handler:function(){c.change_settings({legend:!e.legend})}},{text:"PAN Scrollbars",checked:e.pan,style:"checkbox",handler:function(){c.change_settings({pan:!e.pan})}},
{text:"PHase UNITS...",menu:{title:"PHASE UNITS",items:[{text:"Radians",checked:23===e.plab,handler:function(){c.change_settings({phunits:"R"})}},{text:"Degrees",checked:24===e.plab,handler:function(){c.change_settings({phunits:"D"})}},{text:"Cycles",checked:25===e.plab,handler:function(){c.change_settings({phunits:"C"})}}]}},{text:"SPECS",checked:e.specs,style:"checkbox",handler:function(){c.change_settings({specs:!e.specs})}},{text:"XDIVisions...",handler:function(){Q(c,"X Divisions:",function(c){var e=
a.intValidator(c),q=d.trunc(f.width/2);return e.valid&&c>q?{valid:!1,reason:"Exceeds maximum number of divisions ("+q+")."}:e},function(a){parseFloat(a)!==e.xdiv&&(""===a&&(a=1),e.xdiv=parseFloat(a));c.refresh()},e.xdiv,void 0,void 0,void 0)}},{text:"XLABel...",handler:function(){Q(c,"X Units:",function(c){console.log("The value is "+c);return a.intValidator(c)},function(a){parseFloat(a)!==e.xlab&&(0>a&&(a=0),e.xlab=parseFloat(a));c.refresh()},e.xlab,void 0,void 0,void 0)}},{text:"YDIVisions...",
handler:function(){Q(c,"Y Divisions:",function(c){var e=a.intValidator(c),q=d.trunc(f.height/2);return e.valid&&c>q?{valid:!1,reason:"Exceeds maximum number of divisions ("+q+")."}:e},function(a){parseFloat(a)!==e.ydiv&&(""===a&&(a=1),e.ydiv=parseFloat(a));c.refresh()},e.ydiv,void 0,void 0,void 0)}},{text:"YINVersion",checked:4===f.origin,style:"checkbox",handler:function(){c.change_settings({yinv:4!==f.origin})}},{text:"YLABel...",handler:function(){Q(c,"Y Units:",function(c){return a.intValidator(c)},
function(a){parseFloat(a)!==e.ylab&&(0>a&&(a=0),e.ylab=parseFloat(a));c.refresh()},e.ylab,void 0,void 0,void 0)}},{text:"X-axis",checked:e.show_x_axis,style:"checkbox",handler:function(){c.change_settings({show_x_axis:!e.show_x_axis})}},{text:"Y-axis",checked:e.show_y_axis,style:"checkbox",handler:function(){c.change_settings({show_y_axis:!e.show_y_axis})}},{text:"Readout",checked:e.show_readout,style:"checkbox",handler:function(){c.change_settings({show_readout:!e.show_readout})}},{text:"Invert Colors",
checked:f.xi,style:"checkbox",handler:function(){a.invertbgfg(f)}}]}},l={text:"Colormap...",menu:{title:"COLORMAP",items:[]}},p=function(a){c.change_settings({cmap:this.cmap})},t=0;t<d.Mc.colormap.length;t++)l.menu.items.push({text:d.Mc.colormap[t].name,cmap:t,checked:e.cmap===t,handler:p});var u=function(d){return{title:"TRACE OPTIONS",items:[{text:"Dashed...",handler:function(){var f=1;if(void 0!==d)f=Math.abs(c._Gx.lyr[d].thick);else{if(0===e.lyr.length)return;for(var f=Math.abs(c._Gx.lyr[0].thick),
r=0;r<e.lyr.length;r++)if(f!==Math.abs(c._Gx.lyr[r].thick)){f=1;break}}Q(c,"Line thickness:",a.intValidator,function(a){if(void 0!==d)c._Gx.lyr[d].line=3,c._Gx.lyr[d].thick=-1*a,c._Gx.lyr[d].symbol=0;else for(var d=0;d<e.lyr.length;d++)c._Gx.lyr[d].line=3,c._Gx.lyr[d].thick=-1*a,c._Gx.lyr[d].symbol=0},f)}},{text:"Dots...",handler:function(){var f=3;if(void 0!==d)f=Math.abs(c._Gx.lyr[d].radius);else{if(0===e.lyr.length)return;for(var r=0;r<e.lyr.length;r++)if(f!==Math.abs(c._Gx.lyr[r].radius)){f=3;
break}}Q(c,"Radius/Shape:",a.intValidator,function(a){var f;0>a?(f=3,a=Math.abs(a)):0<a?f=2:(f=1,a=0);if(void 0!==d)c._Gx.lyr[d].line=0,c._Gx.lyr[d].radius=a,c._Gx.lyr[d].symbol=f;else for(var r=0;r<e.lyr.length;r++)c._Gx.lyr[r].line=0,c._Gx.lyr[r].radius=a,c._Gx.lyr[r].symbol=f},f)}},{text:"Solid...",handler:function(){var f=1;if(void 0!==d)f=Math.abs(c._Gx.lyr[d].thick);else{if(0===e.lyr.length)return;for(var f=Math.abs(c._Gx.lyr[0].thick),r=0;r<e.lyr.length;r++)if(f!==Math.abs(c._Gx.lyr[r].thick)){f=
1;break}}Q(c,"Line thickness:",a.intValidator,function(a){if(void 0!==d)c._Gx.lyr[d].line=3,c._Gx.lyr[d].thick=a,c._Gx.lyr[d].symbol=0;else for(var f=0;f<e.lyr.length;f++)c._Gx.lyr[f].line=3,c._Gx.lyr[f].thick=a,c._Gx.lyr[f].symbol=0},f)}},{text:"Toggle",style:void 0!==d?"checkbox":void 0,checked:void 0!==d?c._Gx.lyr[d].display:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].display=!c._Gx.lyr[d].display;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].display=!c._Gx.lyr[a].display}},{text:"Symbols...",
menu:{title:"SYMBOLS",items:[{text:"Retain Current"},{text:"None",checked:void 0!==d?0===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].radius=0,c._Gx.lyr[d].symbol=0;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=0,c._Gx.lyr[a].symbol=0}},{text:"Pixels",checked:void 0!==d?1===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].radius=1,c._Gx.lyr[d].symbol=1;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=1,c._Gx.lyr[a].symbol=1}},{text:"Circles",
checked:void 0!==d?2===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].radius=4,c._Gx.lyr[d].symbol=2;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=4,c._Gx.lyr[a].symbol=2}},{text:"Squares",checked:void 0!==d?3===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].radius=4,c._Gx.lyr[d].symbol=3;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=4,c._Gx.lyr[a].symbol=3}},{text:"Plusses",checked:void 0!==d?4===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==
d)c._Gx.lyr[d].radius=4,c._Gx.lyr[d].symbol=4;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=4,c._Gx.lyr[a].symbol=4}},{text:"X's",checked:void 0!==d?5===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].radius=4,c._Gx.lyr[d].symbol=5;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=4,c._Gx.lyr[a].symbol=5}},{text:"Triangles",checked:void 0!==d?6===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].radius=6,c._Gx.lyr[d].symbol=6;else for(var a=
0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=6,c._Gx.lyr[a].symbol=6}},{text:"Downward Triangles",checked:void 0!==d?7===c._Gx.lyr[d].symbol:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].radius=6,c._Gx.lyr[d].symbol=7;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].radius=6,c._Gx.lyr[a].symbol=7}}]}},{text:"Line Type...",menu:{title:"LINE TYPE",items:[{text:"Retain Current"},{text:"None",checked:void 0!==d?0===c._Gx.lyr[d].line:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].line=0;else for(var a=
0;a<e.lyr.length;a++)c._Gx.lyr[a].line=0}},{text:"Verticals",checked:void 0!==d?1===c._Gx.lyr[d].line:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].line=1;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].line=1}},{text:"Horizontals",checked:void 0!==d?2===c._Gx.lyr[d].line:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].line=2;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].line=2}},{text:"Connecting",checked:void 0!==d?3===c._Gx.lyr[d].line:void 0,handler:function(){if(void 0!==d)c._Gx.lyr[d].line=
3;else for(var a=0;a<e.lyr.length;a++)c._Gx.lyr[a].line=3}}]}},{text:"Thickness...",handler:function(){var f=1;void 0!==d&&(f=c._Gx.lyr[d].thick);Q(c,"Thickness",a.intValidator,function(a){""===a&&(a=1);a=Math.max(0,a);if(void 0!==d)c._Gx.lyr[d].thick=a;else for(var f=0;f<e.lyr.length;f++)c._Gx.lyr[f].thick=a},f,void 0,void 0,void 0)}},{text:"Opacity...",handler:function(){var f=1;void 0!==d&&(f=c._Gx.lyr[d].opacity);Q(c,"Opacity:",a.floatValidator,function(a){""===a&&(a=1);a=Math.max(0,a);a=Math.min(1,
a);if(void 0!==d)c._Gx.lyr[d].opacity=a;else for(var f=0;f<e.lyr.length;f++)c._Gx.lyr[f].opacity=a},f,void 0,void 0,void 0)}}]}},p={text:"Plugins...",menu:{title:"PLUGINS",items:function(){for(var a=[],d=0;d<e.plugins.length;d++){var c=e.plugins[d];c.impl.menu&&("function"===typeof c.impl.menu?a.push(c.impl.menu()):a.push(c.impl.menu))}return a}()}};a.menu(f,{title:"SIG-PLOT",finalize:function(){f.prompt||a.addEventListener(f,"mousedown",c.onmousedown,!1);c.refresh()},items:[{text:"Refresh"},r,g,
h,{text:"View...",menu:{title:"VIEW",items:[{text:"Reset",handler:function(){c.unzoom()}},{text:"Y Axis",style:"separator"},{text:"Expand Range",handler:function(){M(c,a.SB_EXPAND,"YPAN")}},{text:"Shrink Range",handler:function(){M(c,a.SB_SHRINK,"YPAN")}},{text:"Expand Full",handler:function(){M(c,a.SB_FULL,"YPAN")}},{text:"X Axis",style:"separator"},{text:"Expand Range",handler:function(){M(c,a.SB_EXPAND,"XPAN")}},{text:"Shrink Range",handler:function(){M(c,a.SB_SHRINK,"XPAN")}},{text:"Expand Full",
handler:function(){M(c,a.SB_FULL,"XPAN")}}]}},{text:"Grid",handler:function(){c.change_settings({grid:!e.grid})}},k,l,{text:"Traces...",menu:function(){var a=c._Gx,d={title:"TRACE",items:[]};d.items.push({text:"All",menu:u()});for(var e=0;e<a.lyr.length;e++)d.items.push({text:a.lyr[e].name,menu:u(e)});return d}},{text:"Files...",menu:{title:"FILES OPTIONS",items:[{text:"Deoverlay File...",menu:function(){var a=c._Gx,d={title:"DEOVERLAY",items:[]};d.items.push({text:"Deoverlay All",handler:function(){c.deoverlay()}});
for(var e=0;e<a.lyr.length;e++){var f=function(a){return function(){c.deoverlay(a)}}(e);d.items.push({text:a.lyr[e].name,handler:f})}return d}}]}},p,{text:"Keypress Info",handler:function(){a.message(f,Z)}},{text:"Save as...",menu:{title:"SAVE AS",items:[{text:"PNG",handler:function(){var a=c._Mx.active_canvas.toDataURL("image/png"),d=document.createElement("a");d.href=a;d.download="SigPlot."+(new Date).getTime()+".png";d.click()}},{text:"JPG",handler:function(){var a=c._Mx.active_canvas.toDataURL("image/jpg"),
d=document.createElement("a");d.href=a;d.download="SigPlot."+(new Date).getTime()+".jpg";d.click()}},{text:"SVG",handler:function(){var a=c._Mx.active_canvas.toDataURL("image/svg"),d=document.createElement("a");d.href=a;d.download="SigPlot."+(new Date).getTime()+".svg";d.click()}}]}},{text:"Exit",handler:function(){var d=document.createEvent("Event");d.initEvent("sigplotexit",!0,!0);a.dispatchEvent(f,d)}}]})}function g(d,c){return function(e,f,g,h,k,l,n){var p=d._Mx,t=Math.min(f,h),u=Math.min(g,k),
v=Math.abs(h-f),w=Math.abs(k-g),x=!1;e.which===c&&(x="horizontal"===n?2<v:"vertical"===n?2<w:2<v&&2<w);x?void 0===l||"zoom"===l?(d.pixel_zoom(f,g,h,k),d.refresh()):"select"===l&&(f=document.createEvent("Event"),f.initEvent("mtag",!0,!0),g=V(d,t,u),h=V(d,t+v,u+w),f.x=g.x,f.y=g.y,f.xpos=t,f.ypos=u,f.w=Math.abs(h.x-g.x),f.h=Math.abs(h.y-g.y),f.wpxl=v,f.hpxl=w,f.shift=e.shiftKey,a.dispatchEvent(p,f)):d.mouseup(e)}}function k(c,e){var f=c._Mx,r=c._Gx;r.xmin=void 0===e.xmin?0:e.xmin;r.xmax=void 0===e.xmax?
0:e.xmax;var g=void 0!==e.xmin,k=void 0!==e.xmax,l=void 0===e.cmode?"":e.cmode.toUpperCase();r.ylab=e.ylab;r.ymin=void 0===e.ymin?0:e.ymin;r.ymax=void 0===e.ymax?0:e.ymax;var n=void 0!==e.ymin,t=void 0!==e.ymax;r.zmin=e.zmin;r.zmax=e.zmax;var u=void 0!==e.zmin,v=void 0!==e.zmax;void 0!==e.colors&&a.setbgfg(f,e.colors.bg,e.colors.fg,f.xi);void 0!==e.xi&&a.invertbgfg(f);r.forcelab=void 0===e.forcelab?!0:e.forcelab;r.all=void 0===e.all?!1:e.all;r.expand=void 0===e.expand?!1:e.expand;r.xlab=e.xlab;r.segment=
void 0===e.segment?!1:e.segment;r.plab=24;var w=void 0===e.phunits?"D":e.phunits;"R"===w[0]?r.plab=23:"C"===w[0]&&(r.plab=25);r.xdiv=void 0===e.xdiv?5:e.xdiv;r.ydiv=void 0===e.ydiv?5:e.ydiv;f.origin=1;e.yinv&&(f.origin=4);r.pmt=void 0===e.pmt?1:e.pmt;r.bufmax=void 0===e.bufmax?32768:e.bufmax;r.sections=void 0===e.nsec?0:e.nsec;r.anno_type=void 0===e.anno_type?0:e.anno_type;r.xfmt=void 0===e.xfmt?"":e.xfmt;r.yfmt=void 0===e.yfmt?"":e.yfmt;r.index=void 0===e.index?!1:e.index;if(w=r.index||"IN"===l.slice(0,
2))g&&1===r.xmin&&(g=!1),k&&1===r.xmin&&(k=!1);r.xdata=!1;r.note="";r.hold=0;r.always_show_marker=e.always_show_marker||!1;d.vstype("D");e.inputs||h(c,!1);var x=l.slice(0,2);if("IN"===x||"AB"===x||"__"===x)x=l.slice(2,4);r.cmode=0<r.lyr.length&&r.lyr[0].cx?1:3;"MA"===x&&(r.cmode=1);"PH"===x&&(r.cmode=2);"RE"===x&&(r.cmode=3);"IM"===x&&(r.cmode=4);if("LO"===x||"D1"===x)r.cmode=6;if("L2"===x||"D2"===x)r.cmode=7;if("RI"===x||"IR"===x)r.index?alert("Imag/Real mode not permitted in INDEX mode"):r.cmode=
5;r.basemode=r.cmode;c.change_settings({cmode:r.cmode});r.dbmin=1E-20;6<=r.cmode&&(l=10,7===r.cmode&&(l=20),"L"===x[0]?0<r.lyr.length&&r.lyr[0].cx?(r.ymin=Math.max(r.ymin,1E-10),r.ymax=Math.max(r.ymax,1E-10)):(r.ymin=Math.max(r.ymin,1E-20),r.ymax=Math.max(r.ymax,1E-20)):0<r.lyr.length&&r.lyr[0].cx?(r.ymin=Math.max(-18*l,r.ymin),r.ymax=Math.max(-18*l,r.ymax),r.dbmin=1E-37):Math.min(r.ymin,r.ymax)<-20*l&&(r.ymin=Math.max(-37*l,r.ymin),r.ymax=Math.max(-37*l,r.ymax),r.dbmin=Math.pow(10,Math.min(r.ymin,
r.ymax)/l)));f.level=0;w&&!r.index&&(g&&(r.xmin=r.xstart+r.xdelta*(r.xmin-1)),g&&(r.xmax=r.xstart+r.xdelta*(r.xmax-1)));r.xmult=e.xmult;r.ymult=e.xmult;r.autox=void 0===e.autox?-1:e.autox;0>r.autox&&(r.autox=0,g||(r.autox+=1),k||(r.autox+=2));r.autoy=void 0===e.autoy?-1:e.autoy;0>r.autoy&&(r.autoy=0,n||(r.autoy+=1),t||(r.autoy+=2));r.autoz=void 0===e.autoz?-1:e.autoz;0>r.autoz&&(r.autoz=0,u||(r.autoz+=1),v||(r.autoz+=2));r.autol=void 0===e.autol?-1:e.autol;g||(r.xmin=void 0);k||(r.xmax=void 0);F(c,
{get_data:!0},r.xmin,r.xmax,r.xlab,r.ylab);g||(r.xmin=f.stk[0].xmin);k||(r.xmax=f.stk[0].xmax);n||(r.ymin=f.stk[0].ymin);t||(r.ymax=f.stk[0].ymax);r.xmin>r.xmax&&(f.stk[0].xmin=r.xmax,r.xmax=r.xmin,r.xmin=f.stk[0].xmin);r.ymin>r.ymax&&(f.stk[0].ymin=r.ymax,r.ymax=r.ymin,r.ymin=f.stk[0].ymin);f.stk[0].xmin=r.xmin;f.stk[0].xmax=r.xmax;f.stk[0].ymin=r.ymin;f.stk[0].ymax=r.ymax;r.panxmin=Math.min(r.panxmin,r.xmin);r.panxmax=Math.max(r.panxmax,r.xmax);r.panymin=Math.min(r.panymin,r.ymin);r.panymax=Math.max(r.panymax,
r.ymax);r.xmin=f.stk[0].xmin;r.ymin=f.stk[0].ymin;a.set_font(f,Math.min(7,f.width/64));r.ncolors=void 0===e.ncolors?16:e.ncolors;r.cmap=null;r.cmap=e.cmap?e.cmap:void 0===e.xc?-1:e.xc;p(c,r.cmap);r.cntrls="leftmouse"===e.xcnt?1:"continuous"===e.xcnt?2:void 0===e.xcnt?1:e.xcnt;r.default_rubberbox_mode=void 0===e.rubberbox_mode?"box":e.rubberbox_mode;r.default_rubberbox_action=void 0===e.rubberbox_action?"zoom":e.rubberbox_action;r.default_rightclick_rubberbox_mode=void 0===e.rightclick_rubberbox_mode?
"box":e.rightclick_rubberbox_mode;r.default_rightclick_rubberbox_action=void 0===e.rightclick_rubberbox_action?null:e.rightclick_rubberbox_action;r.cross=void 0===e.cross?!1:e.cross;r.grid=void 0===e.nogrid?!0:!e.nogrid;r.fillStyle=e.fillStyle;r.gridBackground=e.gridBackground;r.gridStyle=e.gridStyle;r.wheelZoom=e.wheelZoom;r.wheelZoomPercent=e.wheelZoomPercent;r.legend=void 0===e.legend?!1:e.legend;r.legendBtnLocation=null;r.pan=void 0===e.nopan?!0:!e.nopan;r.nomenu=void 0===e.nomenu?!1:e.nomenu;
r.modmode=0;r.modlayer=-1;r.modsource=0;r.modified=e.mod&&0<r.lyr.length;r.nmark=0;r.iabsc=0;r.index&&(r.iabsc=1);r.specs=!e.nospecs;r.scroll_time_interval=void 0===e.scroll_time_interval?r.scroll_time_interval:e.scroll_time_interval;r.autohide_readout=e.autohide_readout;r.autohide_panbars=e.autohide_panbars;r.specs?(r.show_x_axis=!e.noxaxis,r.show_y_axis=!e.noyaxis,r.show_readout=!e.noreadout,r.specs=r.show_x_axis||r.show_y_axis||r.show_readout?!0:!1):(r.show_x_axis=!1,r.show_y_axis=!1,r.show_readout=
!1);r.hide_note=e.hide_note||!1;r.xmrk=0;r.ymrk=0;e.nodragdrop||(a.addEventListener(f,"dragover",function(a){a.preventDefault()},!1),a.addEventListener(f,"drop",function(a){return function(d){var c=d.dataTransfer.files;0<c.length&&(d.preventDefault(),a.load_files(c))}}(c),!1))}function h(a,d){var c=a._Gx,e=a._Mx;if(d){var f=c.HCB[0];c.xstart=f.xstart;c.xdelta=f.xdelta}else c.xstart=0,c.xdelta=1,c.autol=-1;e.origin=1}function B(a){for(var d=a._Gx,c=a._Mx.canvas.getContext("2d"),e,f=0;f<d.plugins.length;)d.plugins[f].impl.refresh&&
(e=d.plugins[f].canvas,e.width!==a._Mx.canvas.width&&(e.width=a._Mx.canvas.width),e.height!==a._Mx.canvas.height&&(e.height=a._Mx.canvas.height),0!==e.height&&0!==e.width&&(e.width!==a._Mx.canvas.width&&(e.width=a._Mx.canvas.width),e.height!==a._Mx.canvas.height&&(e.height=a._Mx.canvas.height),e.getContext("2d").clearRect(0,0,e.width,e.height),d.plugins[f].impl.refresh(e),c.drawImage(e,0,0))),f+=1}function t(a){a=a._Gx;if(0===a.HCB.length)a.note="";else if(void 0===a.HCB[0].plotnote){for(var d=[],
c=0;c<a.HCB.length;c++)a.HCB[c].file_name&&d.push(a.HCB[c].file_name);a.note=d.join("|").toUpperCase()}}function u(d,c){var e=d._Mx,f=d._Gx;if(!(c>=f.lyr.length)&&f.lyr[c].display&&0===f.hold){f.lyr[c].draw();var g=document.createEvent("Event");g.initEvent("lyrdraw",!0,!0);g.index=c;g.name=f.lyr[c].name;g.layer=f.lyr[c];a.dispatchEvent(e,g)}}function z(d){var c=d._Gx;d=d._Mx;c.cross&&(("vertical"===c.cross||!0===c.cross)&&d.xpos>=d.l&&d.xpos<=d.r&&c.cross_xpos!==d.xpos&&(void 0!==c.cross_xpos&&a.rubberline(d,
c.cross_xpos,d.t,c.cross_xpos,d.b),a.rubberline(d,d.xpos,d.t,d.xpos,d.b),c.cross_xpos=d.xpos),("horizontal"===c.cross||!0===c.cross)&&d.ypos>=d.t&&d.ypos<=d.b&&c.cross_ypos!==d.ypos&&(void 0!==c.cross_ypos&&a.rubberline(d,d.l,c.cross_ypos,d.r,c.cross_ypos),a.rubberline(d,d.l,d.ypos,d.r,d.ypos),c.cross_ypos=d.ypos))}function A(d){var c=d._Gx;d=d._Mx;if(null!==c.xmrk&&null!==c.ymrk){var e=a.real_to_pixel(d,c.xmrk,c.ymrk);if(!e.clipped){var f=d.active_canvas.getContext("2d");f.beginPath();f.strokeStyle=
d.xwfg;f.fillStyle=d.xwfg;f.arc(e.x,e.y,2,0,360);f.stroke();f.textBaseline="alphabetic";f.textAlign="left";f.fillStyle=d.fg;f.font=d.font.font;var g="x:"+a.format_g(c.xmrk,6,3,!0);f.fillText(g,e.x+5,e.y-5);g="y:"+a.format_g(c.ymrk,6,3,!0);f.fillText(g,e.x+5,e.y-5+d.text_h)}}}function E(a,d){var c=a._Mx,e=a._Gx;e.xdata=!1;for(var f=0;f<e.lyr.length;f++)e.lyr[f].xdata=5===d?!0:!1,e.lyr[f].xdata&&(e.xdata=!0);if(d!==e.cmode)if(5===d&&e.index)alert("Imag/Real mode not permitted in INDEX mode");else if(0>=
e.lyr.length)e.cmode=d,K(a);else if(0<d){f=e.cmode;e.cmode=d;var g=e.autox,h=e.autoy;e.autox=3;e.autoy=3;if(5===d||5===f)e.panxmin=1,e.panxmax=-1,e.panymin=1,e.panymax=-1,c.level=0,d===e.basemode?(c.stk[0].xmin=e.xmin,c.stk[0].xmax=e.xmax,c.stk[0].ymin=e.ymin,c.stk[0].ymax=e.ymax):5===d||5===e.basemode?F(a,{get_data:!0}):(c.stk[0].xmin=e.xmin,c.stk[0].xmax=e.xmax,F(a,{get_data:!0},e.xmin,e.xmax));else for(d===e.basemode?(e.panymin=1,e.panymax=-1,c.stk[0].ymin=e.ymin,c.stk[0].ymax=e.ymax):F(a,{},c.stk[c.level].xmin,
c.stk[c.level].xmax),f=1;f<=c.level;f++)c.stk[f].ymin=c.stk[0].ymin,c.stk[f].ymax=c.stk[0].ymax;e.autox=g;e.autoy=h;a.refresh()}}function I(d){var c,e=d._Mx,f=d._Gx;if(f.pan&&!e.widget){c=e.level;var g={ps:e.stk[c].ymin,pe:e.stk[c].ymax},h=g.ps!==f.panymin||g.pe!==f.panymax,h=h&&0<e.level;!f.autohide_panbars||h&&d.mouseOnCanvas||f.panning?(a.scrollbar(e,0,f.pyl,f.pyl+f.pthk,e.t,e.b,g,f.panymin,f.panymax,void 0,e.scrollbar_y),e.stk[c].ymin=g.ps,e.stk[c].ymax=g.pe):(g=e.canvas.getContext("2d"),g.fillStyle=
e.bg,g.fillRect(f.pyl,e.t,f.pyl+f.pthk,e.b-e.t));f.pl<e.width&&(g={ps:e.stk[c].xmin,pe:e.stk[c].xmax},h=(h=g.ps!==f.panxmin||g.pe!==f.panxmax)&&(!f.all||0<e.level),!f.autohide_panbars||h&&d.mouseOnCanvas||f.panning?(a.scrollbar(e,0,f.pl,f.pr,f.pt,f.pt+f.pthk,g,f.panxmin,f.panxmax,void 0,e.scrollbar_x),e.stk[c].xmin=g.ps,e.stk[c].xmax=g.pe):(g=e.canvas.getContext("2d"),g.fillStyle=e.bg,g.fillRect(f.pl,f.pt-1,f.pr-f.pl,f.pthk+4)))}}function P(d,c,e,f){var g=d._Mx,h=d._Gx,k,l,n,p;p=new a.SCROLLBAR;l=
new a.SCROLLBAR;var t=!1;k=g.level;0<h.panmode?(p.flag=11,l.flag=11):(p.flag=-12,l.flag=-12);0===e&&(p.action=0,l.action=0);if("Y"===c.substring(0,1)){if(p=g.stk[k].ymin,e=g.stk[k].ymax,n=e-p,"YPAN"===c?(c=g.scrollbar_y,e={ps:p,pe:e},a.scrollbar(g,l,h.pyl,h.pyl+h.pthk,g.t,g.b,e,h.panymin,h.panymax,f,c),p=e.ps,e=e.pe,0!==l.action&&a.scroll(g,l,a.XW_UPDATE,void 0,c)):"YCENTER"===c&&(p-=n*(g.ypos-(g.t+g.b)/2)/(g.b-g.t),e=p+n),p!==g.stk[k].ymin||e!==g.stk[k].ymax)g.stk[k].ymin=p,g.stk[k].ymax=e,h.cmode===
h.basemode&&1===g.level&&(h.ymin=Math.min(h.ymin,p),h.ymax=Math.max(h.ymax,e)),this.inPan=!0,f=document.createEvent("Event"),f.initEvent("ypan",!0,!0),f.level=g.level,f.xmin=g.stk[g.level].xmin,f.ymin=g.stk[g.level].ymin,f.xmax=g.stk[g.level].xmax,f.ymax=g.stk[g.level].ymax,a.dispatchEvent(g,f),this.inPan=!1,d.refresh(),t=!0}else if(l=g.stk[k].xmin,e=g.stk[k].xmax,n=e-l,"XPAN"===c?(c=g.scrollbar_x,e={ps:l,pe:e},a.scrollbar(g,p,h.pl,h.pr,h.pt,h.pt+h.pthk,e,h.panxmin,h.panxmax,f,c),l=e.ps,e=e.pe,0!==
p.action&&a.scroll(g,p,a.XW_UPDATE,void 0,c)):"XCENTER"===c&&(l+=n*(g.xpos-(g.l+g.r)/2)/(g.r-g.l),l!==g.stk[k].xmin&&(e=l+n)),g.stk[k].xmin!==l||g.stk[k].xmax!==e)g.stk[k].xmin=l,g.stk[k].xmax=e,h.xdata||1!==g.level||(h.xmin=g.stk[1].xmin,h.xmax=g.stk[1].xmax),this.inPan=!0,f=document.createEvent("Event"),f.initEvent("xpan",!0,!0),f.level=g.level,f.xmin=g.stk[g.level].xmin,f.ymin=g.stk[g.level].ymin,f.xmax=g.stk[g.level].xmax,f.ymax=g.stk[g.level].ymax,a.dispatchEvent(g,f),this.inPan=!1,d.refresh(),
t=!0;return t}function L(d,c,e){var f=d._Mx,g=d._Gx,h,k,l;if("XPAN"===c)l=d._Mx.scrollbar_x;else if("YPAN"===c)l=d._Mx.scrollbar_y;else throw"Unable to drag scrollbar - scrollAction is not 'XPAN' or 'YPAN'!!";l.flag=-12;k=f.level;"XPAN"===c?(h=f.stk[k].xmin,k=f.stk[k].xmax):"YPAN"===c?(h=f.stk[k].ymin,k=f.stk[k].ymax):k=h=void 0;var p=l;p.action=a.SB_DRAG;if("YPAN"===c){var t=f.scrollbar_y.trange/f.scrollbar_y.h;4===p.origin&&(t*=-1);e=e.screenY-g.panning.ypos;e*=t;g.panning.ymin-e<g.panymin?(k=g.panymin+
(k-h),h=g.panymin):g.panning.ymax-e>g.panymax?(h=g.panymax-(k-h),k=g.panymax):(h=g.panning.ymin-e,k=g.panning.ymax-e)}else"XPAN"===c&&(t=f.scrollbar_x.trange/f.scrollbar_x.w,3===p.origin&&(t*=-1),e=e.screenX-g.panning.xpos,e*=t,g.panning.xmin+e<g.panxmin?(k=g.panxmin+(k-h),h=g.panxmin):g.panning.xmax+e>g.panxmax?(h=g.panxmax-(k-h),k=g.panxmax):(h=g.panning.xmin+e,k=g.panning.xmax+e));l.smin=h;l.srange=k-h;a.redrawScrollbar(l,f,void 0);n(d,l.smin,l.smin+l.srange,c.slice(0,1));this.inPan=!0;g=document.createEvent("Event");
"XPAN"===c?g.initEvent("xpan",!0,!0):"YPAN"===c&&g.initEvent("ypan",!0,!0);g.level=f.level;g.xmin=f.stk[f.level].xmin;g.ymin=f.stk[f.level].ymin;g.xmax=f.stk[f.level].xmax;g.ymax=f.stk[f.level].ymax;a.dispatchEvent(f,g);this.inPan=!1;l.action=0;d.refresh()}function Q(d,c,e,f,g,h,k,l){var n=d._Mx;if(n.prompt)throw"Prompt already exists! Can only have one prompt at a time!";a.disableListeners(n);d.disable_listeners();var p=function(d,c){return function(e){c(e);a.enableListeners(n);d.enable_listeners();
d.refresh();void 0!==l&&l()}},t=function(){d.refresh()};try{a.prompt(n,c,e,p(d,f),t,g,h,k,5E3)}catch(u){console.log("ERROR: Failed to set up prompt due to: "+u)}}function K(c){var e=c._Mx,f=c._Gx,g=e.canvas.getContext("2d");0===f.sections&&(f.isec=0);if(e.warpbox){var h=V(c,e.warpbox.xo,e.warpbox.yo),k=V(c,e.warpbox.xl,e.warpbox.yl);f.aretx=h.x;f.arety=h.y;f.dretx=k.x-h.x;f.drety=k.y-h.y}else f.aretx=f.retx,f.arety=f.rety,f.dretx=f.retx-f.xmrk,f.drety=f.rety-f.ymrk;5===f.cmode&&1===f.iabsc&&(f.iabsc=
2);1===f.iabsc?(f.aretx=Math.round((f.aretx-f.xstart)/f.xdelta),f.index||(f.aretx+=1),f.dretx=Math.round(f.dretx/f.xdelta)):2===f.iabsc&&(0!==f.aretx&&(f.aretx=1/f.aretx),0!==f.arety&&(f.arety=1/f.arety),0!==f.dretx&&(f.dretx=1/f.dretx),0!==f.drety&&(f.drety=1/f.drety));if(f.show_readout&&!e.widget&&(g.fillStyle=e.bg,k=Math.floor(e.height-2.5*e.text_h),g.fillRect(e.text_w,k,49*e.text_w,k+1.5*e.text_h),k=Math.floor(e.height-0.5*e.text_h),h=Math.max(f.pr+e.text_w,e.width-2*e.text_w),g.fillStyle=e.bg,
g.fillRect(h,k-e.text_h,e.text_w,e.text_h),!f.autohide_readout||c.mouseOnCanvas||f.panning)){var l;0===f.iabsc&&4===f.ylab?(k=(d.sec2tspec(f.arety)+"                ").substring(0,16),l=(d.sec2tspec(f.drety,"delta")+"                ").substring(0,16)):(k=a.format_g(f.arety,16,9,!0),l=a.format_g(f.drety,16,9));0===f.iabsc&&4===f.xlab?(c=(d.sec2tspec(f.aretx)+"                ").substring(0,16),g=(d.sec2tspec(f.dretx,"delta")+"                ").substring(0,16)):(c=a.format_g(f.aretx,16,9,!0),g=a.format_g(f.dretx,
16,9));l="y: "+k+" dy: "+l+" L="+e.level+" "+x[f.cmode-1];c="x: "+c+" dx: "+g+" "+W[f.iabsc];3===f.iabsc&&(l=0===f.dretx?l.substr(0,20)+"sl: Inf             "+l.substr(40,l.length):l.substr(0,20)+"sl: "+a.format_g(f.drety/f.dretx,16,9)+l.substr(40,l.length));k=Math.floor(e.height-1.5*e.text_h);a.text(e,e.text_w,k,l);k=Math.floor(e.height-0.5*e.text_h);a.text(e,e.text_w,k,c);a.LEGACY_RENDER&&h<e.width&&(0<f.cntrls?a.text(e,h,k,"C"):a.text(e,h,k," "));a.colorbar(e,49*e.text_w-3,e.height-2.5*e.text_h,
e.text_w,2*e.text_h)}}function F(a,d,c,e,f,g){var h=a._Mx;a=a._Gx;d=!0===d.get_data;a.panxmin=1;a.panxmax=-1;a.panymin=1;a.panymax=-1;var k=void 0===c,l=void 0===e;if(0===a.lyr.length)a.panxmin=-1,a.panxmax=1,a.panymin=-1,a.panymax=1;else for(void 0===f&&(a.xlab=a.lyr[0].xlab),void 0===g&&(a.ylab=a.lyr[0].ylab),f=0;f<a.lyr.length;f++)if(k&&(c=a.lyr[f].xmin),l&&(e=a.lyr[f].xmax),a.xlab!==a.lyr[f].xlab&&(a.xlab=0),a.ylab!==a.lyr[f].ylab&&(a.ylab=0),d&&a.lyr[f].get_data(c,e),0<a.autox||0<a.autoy)for(;c<
e;)a.lyr[f].get_data(c,e),g=a.lyr[f].prep(c,e),a.all&&a.expand?0===a.lyr[f].size?c=e:a.index?c+=g:0<=a.lyr[f].xdelta?c+=a.lyr[f].size*a.lyr[f].xdelta:e+=a.lyr[f].size*a.lyr[f].xdelta:c=e;else a.lyr[f].prep(1,-1);f=a.panxmax-a.panxmin;0>f&&(a.panxmax=a.panxmin,a.panxmin=a.panxmax+f,f=-f);1E-20>=f&&(a.panxmin-=1,a.panxmax+=1);0!==(a.autox&1)&&k&&(h.stk[0].xmin=a.panxmin);if(0!==(a.autox&2)&&l&&(h.stk[0].xmax=a.panxmax,!a.all&&!a.xdata))for(f=0;f<a.lyr.length;f++)e=Math.min(a.lyr[f].xmax,h.stk[0].xmax),
g=Math.abs((e-a.lyr[f].xmin)/a.lyr[f].xdelta)-a.bufmax+1,0<g&&(h.stk[0].xmax=e-g*Math.abs(a.lyr[f].xdelta));0!==(a.autoy&1)&&(h.stk[0].ymin=a.panymin);0!==(a.autoy&2)&&(h.stk[0].ymax=a.panymax)}function V(d,c,e){var f=d._Gx;d=a.pixel_to_real(d._Mx,c,e);f.index&&(d.x*=f.xdelta);return d}function c(a,d,c,e,f,g){return a>=c&&a<=c+f&&d>=e&&d<=e+g}function v(a){var c=!1,e=a._Gx,f=a._Mx,g=f.xpos,h=f.ypos,k=" ";if(!a.mouseOnCanvas)return!1;e.pan&&g>f.r&&h>=f.t&&h<=f.b?(k="YPAN",f.xpos=e.pyl+d.trunc(e.pthk/
2),c=!0):e.pan&&g>=e.pl&&g<=e.pr&&(e.show_readout&&h>e.pt-2||!e.show_readout&&h<=e.pt+e.pthk+2)&&(k="XPAN",f.ypos=e.pt+d.trunc(e.pthk/2),c=!0);return{inPanRegion:c,command:k}}function y(a){var c=!1;a=a._Mx;var e=a.xpos,f=a.ypos,g=a.text_h,h=a.text_w,k=" ";e<a.l-h&&f<=a.b&&f>=a.t?(k="YCENTER",c=!0):f>a.b+d.trunc(0.5*h)&&f<=a.b+d.trunc(d.trunc(3*g)/2)&&e>=a.l&&e<=a.r&&(k="XCENTER",c=!0);return{inCenterRegion:c,command:k}}function G(d,c){var e,f,g;c.origin&1?(g=d.x-c.x,c.origin&2&&(g=c.w-g)):(g=d.y-
c.y,2>=c.origin&&(g=c.h-g));f=a.scroll_real2pix(c);e=f.s1;f=f.sw;return g>=e&&g<=e+f?!0:!1}function M(d,c,e){var f=d._Mx,g;"XPAN"===e?g=f.scrollbar_x:"YPAN"===e&&(g=f.scrollbar_y);g.action=c;g.step=0.1*g.srange;g.page=9*g.step;g.scale=2;a.scroll(f,g,a.XW_COMMAND,void 0,g);n(d,g.smin,g.smin+g.srange,e.slice(0,1));this.inPan=!0;d=document.createEvent("Event");"XPAN"===e?d.initEvent("xpan",!0,!0):"YPAN"===e&&d.initEvent("ypan",!0,!0);d.level=f.level;d.xmin=f.stk[f.level].xmin;d.ymin=f.stk[f.level].ymin;
d.xmax=f.stk[f.level].xmax;d.ymax=f.stk[f.level].ymax;a.dispatchEvent(f,d);this.inPan=!1}function n(a,d,c,e){var f=a._Mx,g=a._Gx,h=f.level;if("X"===e){if(f.stk[h].xmin!==d||f.stk[h].xmax!==c)f.stk[h].xmin=d,f.stk[h].xmax=c,g.xdata||1!==f.level||(g.xmin=f.stk[1].xmin,g.xmax=f.stk[1].xmax),a.refresh()}else"Y"!==e||d===f.stk[h].ymin&&c===f.stk[h].ymax||(f.stk[h].ymin=d,f.stk[h].ymax=c,g.cmode===g.basemode&&1===f.level&&(g.ymin=Math.min(g.ymin,d),g.ymax=Math.max(g.ymax,c)),a.refresh())}var Z="Keypress Table:\n--------------\n?    - Main help box.\nA    - Toggle display x,y readouts:\n       (absc) -> (index) -> (1/absc) -> (time).\nB    - Toggle LM Drag Mode:\n       (box) -> (horizontal) -> (vertical).\nC    - Toggle controls.\nK    - Show Marker.\nL    - Toggle legend.\nM    - Pops up main menu\nR    - Toggle display specs (x/y readout)\nS    - Toggle display specs and axes.\nT    - Popup box with timecode value at mouse.\nX    - Popup box with X value at mouse.\nY    - Popup box with Y value at mouse.\nF    - Toggle fullscreen.\n";
e.browserIsCompatible=function(){var a=document.createElement("canvas").getContext?!0:!1,d="ArrayBuffer"in window;return a&&d};navigator.userAgent.match(/(iPad|iPhone|iPod)/i)||"undefined"===typeof Float64Array||Float64Array.emulated||!Float64Array.BYTES_PER_ELEMENT?e.PointArray=Float32Array:e.PointArray=Float64Array;e.Plot=function(q,h){if(!e.browserIsCompatible())throw"Browser is not compatible";var p=this._Mx=a.open(q);this._Gx=new w;this._Gx.parent=q;this.mouseOnCanvas=!1;h||(h={});k(this,h);
this._refresh();this.onmousemove=function(d){return function(c){var e=d._Mx,f=d._Gx,g=c.target.getBoundingClientRect(),q=void 0===c.offsetX?c.pageX-g.left-window.scrollX:c.offsetX;c=void 0===c.offsetX?c.pageY-g.top-window.scrollY:c.offsetY;g=V(d,q,c);f.retx=g.x;f.rety=g.y;e.widget||(K(d),g=document.createEvent("Event"),g.initEvent("mmove",!0,!0),g.xpos=q,g.ypos=c,g.x=f.retx,g.y=f.rety,a.dispatchEvent(e,g)&&(f.cross&&(e.warpbox?(void 0!==f.cross_xpos&&a.rubberline(e,f.cross_xpos,e.t,f.cross_xpos,e.b),
void 0!==f.cross_ypos&&a.rubberline(e,e.l,f.cross_ypos,e.r,f.cross_ypos),f.cross_xpos=void 0,f.cross_ypos=void 0):z(d)),2===f.cntrls&&(g=document.createEvent("Event"),g.initEvent("mtag",!0,!0),g.x=f.retx,g.y=f.rety,g.xpos=q,g.ypos=c,a.dispatchEvent(e,g))))}}(this);this.ontouchmove=function(a){return function(d){d.preventDefault();a.onmousemove(d)}}(this);this.throttledOnMouseMove=d.throttle(this._Gx.scroll_time_interval,this.onmousemove);a.addEventListener(p,"mousemove",this.throttledOnMouseMove,
!1);this.onmouseout=function(a){return function(d){d=a._Gx;var c=a._Mx;a.mouseOnCanvas&&(a.mouseOnCanvas=!1,d.autohide_readout&&K(a),d.autohide_panbars&&I(a),c.prompt&&c.prompt.input.enableBlur())}}(this);a.addEventListener(p,"mouseout",this.onmouseout,!1);this.onmouseover=function(a){return function(d){d=a._Gx;var c=a._Mx;a.mouseOnCanvas=!0;d.autohide_panbars&&I(a);c.prompt&&c.prompt.input.disableBlur()}}(this);a.addEventListener(p,"mouseover",this.onmouseover,!1);this.onmousedown=function(d){return function(e){e.preventDefault();
var q=d._Mx,h=d._Gx;q.widget&&"ONESHOT"===q.widget.type&&(q.widget=null,d.refresh());a.ifevent(q,e);var k=document.createEvent("Event");k.initEvent("mdown",!0,!0);k.xpos=q.xpos;k.ypos=q.ypos;k.x=h.retx;k.y=h.rety;k.which=e.which;if(!a.dispatchEvent(q,k))return!1;var s=v(d);if(s.inPanRegion){if(e.preventDefault()," "!==s.command){var n=null,k=null;"XPAN"===s.command?n=q.scrollbar_x:"YPAN"===s.command&&(n=q.scrollbar_y);if(2===e.which)k={x:q.xpos,y:q.ypos},void 0!==n&&G(k,n)&&f(d,s.command);else if(" "!==
s.command&&(k={x:q.xpos,y:q.ypos},!G(k,n)&&1===e.which)){P(d,s.command,0,e);var p=function(){G({x:q.xpos,y:q.ypos},n)?h.stillPanning&&(window.clearInterval(h.stillPanning),h.repeatPanning=void 0):P(d,s.command,0,e)};h.stillPanning=window.setTimeout(function(){h.repeatPanning=window.setInterval(p,50)},250)}}}else if(1===e.which||3===e.which)if(k=!1,h.legendBtnLocation&&(k=c(q.xpos,q.ypos,h.legendBtnLocation.x,h.legendBtnLocation.y,h.legendBtnLocation.width,h.legendBtnLocation.height)),k)d.change_settings({legend:!h.legend});
else{K(d);var k={opacity:0,return_value:"zoom"},t={opacity:0.4,fill_color:q.hi,return_value:"select"};1===e.which?"zoom"===h.default_rubberbox_action?a.rubberbox(q,g(d,e.which),h.default_rubberbox_mode,k,t):"select"===h.default_rubberbox_action&&a.rubberbox(q,g(d,e.which),h.default_rubberbox_mode,t,k):3===e.which&&("zoom"===h.default_rightclick_rubberbox_action?a.rubberbox(q,g(d,e.which),h.default_rightclick_rubberbox_mode,k,t):"select"===h.default_rightclick_rubberbox_action&&a.rubberbox(q,g(d,e.which),
h.default_rightclick_rubberbox_mode,t,k))}else 2===e.which&&(h.nomenu||l(d));return!1}}(this);this.ontouchstart=function(a){return function(d){d.preventDefault();a.onmousedown({which:1})}}(this);a.addEventListener(p,"mousedown",this.onmousedown,!1);this.docMouseUp=function(a){return function(d){var c=a._Gx;1===d.which&&(c.panning=void 0,a._Mx.scrollbar_x.action=0,a._Mx.scrollbar_y.action=0);c.stillPanning&&(window.clearTimeout(c.stillPanning),c.stillPanning=void 0);c.repeatPanning&&(window.clearInterval(c.repeatPanning),
c.repeatPanning=void 0);return!1}}(this);document.addEventListener("mouseup",this.docMouseUp,!1);this.mouseup=function(d){return function(c){c.preventDefault();var e=d._Gx,f=d._Mx;if(!f.warpbox){a.ifevent(d._Mx,c);var g=document.createEvent("Event");g.initEvent("mup",!0,!0);g.xpos=f.xpos;g.ypos=f.ypos;g.x=e.retx;g.y=e.rety;g.which=c.which;if(g=a.dispatchEvent(f,g))if(1===c.which)g=y(d),g.inCenterRegion?" "!==g.command&&P(d,g.command,0,c):1===e.cntrls&&(e.xmrk=e.retx,e.ymrk=e.rety,g=document.createEvent("Event"),
g.initEvent("mtag",!0,!0),g.x=e.xmrk,g.y=e.ymrk,g.xpos=c.x||c.clientX,g.ypos=c.y||c.clientY,g.w=void 0,g.h=void 0,g.shift=c.shiftKey,a.dispatchEvent(f,g),(e.always_show_marker||e.show_marker)&&d.redraw());else if(2===c.which){if(e.nomenu&&(g=document.createEvent("Event"),g.initEvent("showmenu",!0,!0),g.x=c.x||c.clientX,g.y=c.y||c.clientY,g=a.dispatchEvent(f,g))){c.stopPropagation&&c.stopPropagation();c.cancelBubble=!0;a.removeEventListener(f,"mousedown",d.onmousedown,!1);var q=function(){try{var c=
document.createEvent("Event");c.initEvent("hidemenu",!0,!0);a.dispatchEvent(f,c)&&a.addEventListener(f,"mousedown",d.onmousedown,!1)}finally{document.removeEventListener("mouseup",q,!1)}};document.addEventListener("mouseup",q,!1)}}else 3===c.which&&(c.preventDefault(),d.unzoom(1),d.refresh())}}}(this);this.ontouchend=function(a){return function(a){a.preventDefault()}}(this);a.addEventListener(p,"mouseup",this.mouseup,!1);this.mouseclick=function(d){return function(c){c.preventDefault();var e=d._Gx,
f=d._Mx;a.ifevent(d._Mx,c);var g=document.createEvent("Event");g.initEvent("mclick",!0,!0);g.xpos=f.xpos;g.ypos=f.ypos;g.x=e.retx;g.y=e.rety;g.which=c.which;a.dispatchEvent(f,g);return!1}}(this);a.addEventListener(p,"click",this.mouseclick,!1);this.mousedblclick=function(d){return function(c){c.preventDefault();var e=d._Gx,f=d._Mx;a.ifevent(d._Mx,c);var g=document.createEvent("Event");g.initEvent("mdblclick",!0,!0);g.xpos=f.xpos;g.ypos=f.ypos;g.x=e.retx;g.y=e.rety;g.which=c.which;a.dispatchEvent(f,
g);return!1}}(this);a.addEventListener(p,"dblclick",this.mousedblclick,!1);this.dragMouseDownHandler=function(a){return function(d){var c=a._Mx,e=a._Gx,f=v(a);if(f.inPanRegion&&(d.preventDefault()," "!==f.command)){var g;"XPAN"===f.command?g=c.scrollbar_x:"YPAN"===f.command&&(g=c.scrollbar_y);var q={x:c.xpos,y:c.ypos};void 0!==g&&G(q,g)&&1===d.which&&(e.panning={axis:f.command,xpos:d.screenX,ypos:d.screenY,xmin:c.stk[c.level].xmin,xmax:c.stk[c.level].xmax,ymin:c.stk[c.level].ymin,ymax:c.stk[c.level].ymax})}}}(this);
window.addEventListener("mousedown",this.dragMouseDownHandler,!1);this.dragMouseMoveHandler=function(a){return function(d){var c=a._Gx;if(void 0!==c.panning)try{L(a,c.panning.axis,d)}catch(e){console.log("Error: "+e)}}}(this);this.throttledDragOnMouseMove=d.throttle(this._Gx.scroll_time_interval,this.dragMouseMoveHandler);window.addEventListener("mousemove",this.throttledDragOnMouseMove,!1);this.dragMouseUpHandler=function(a){return function(d){var c=a._Gx;1===d.which&&(c.panning=void 0)}}(this);
window.addEventListener("mouseup",this.dragMouseUpHandler,!1);this.onresize=function(d){return function(c){a.checkresize(d._Mx)&&d.refresh()}}(this);this.wheelHandler=function(c){var e=c._Mx,f=c._Gx,g=d.throttle(100,function(d){var g;"XPAN"===d.command?g=e.scrollbar_x:"YPAN"===d.command&&(g=e.scrollbar_y);g.action=f.wheelscroll_mode_natural?0>event.deltaY?a.SB_WHEELDOWN:a.SB_WHEELUP:0>event.deltaY?a.SB_WHEELUP:a.SB_WHEELDOWN;g.step=0.1*g.srange;g.page=9*g.step;a.scroll(e,g,a.XW_COMMAND,void 0,g);
n(c,g.smin,g.smin+g.srange,d.command.slice(0,1))}),q=d.throttle(100,function(){var a=f.wheelZoomPercent||0.2;f.wheelscroll_mode_natural?0<event.deltaY&&(a*=-1):0>event.deltaY&&(a*=-1);"x"===f.wheelZoom?c.percent_zoom(a,1,!0):"y"===f.wheelZoom?c.percent_zoom(1,a,!0):c.percent_zoom(a,a,!0)});return function(d){a.ifevent(e,d);var h=v(c);c.mouseOnCanvas&&(d.preventDefault(),h.inPanRegion?g(h):f.wheelZoom&&q())}}(this);window.addWheelListener(window,this.wheelHandler,!1);window.addEventListener("resize",
this.onresize,!1);h.nokeypress||(this.onkeypress=function(c){return function(e){var f=c._Mx,g=c._Gx;if(c.mouseOnCanvas&&(!f.widget||"MENU"!==f.widget.type))if(f.widget&&"ONESHOT"===f.widget.type)f.widget=null,c.refresh();else{var q=getKeyCode(e),h=document.createEvent("Event");h.initEvent("plotkeypress",!0,!0);h.keyCode=q;h.shiftKey=e.shiftKey;h.ctrlKey=e.ctrlKey;h.altKey=e.altKey;h.metaKey=e.metaKey;if(h=a.dispatchEvent(f,h))97===q?(g.iabsc=(g.iabsc+1)%4,K(c)):108===q?c.change_settings({legend:!g.legend}):
103===q?c.change_settings({grid:!g.grid}):98===q||2===q?f.warpbox&&(f.warpbox.mode="box"===f.warpbox.mode?"horizontal":"horizontal"===f.warpbox.mode?"vertical":"box",a.redraw_warpbox(f)):99===q?c.change_settings({xcnt:-1*g.cntrls}):114===q?c.change_settings({show_readout:!g.show_readout}):115===q?c.change_settings({specs:!g.specs}):120===q?(e=c._Gx,f=c._Mx,g=e.aretx.toString(),1===e.iabsc?a.message(f,"INDEX = "+g):2===e.iabsc?a.message(f,"1/X = "+g):a.message(f,"X = "+g)):121===q?(e=c._Gx,f=c._Mx,
g=e.arety.toString(),2===e.iabsc?a.message(f,"1/Y = "+g):a.message(f,"Y = "+g)):122===q?(e=c._Gx,f=c._Mx,e.zmin&&e.zmax&&(g="",g=1===e.lyr.length?"Z = "+e.lyr[0].get_z(e.retx,e.rety).toString():"TODO",a.message(f,g))):116===q?(e=c._Gx,f=c._Mx,0<e.lyr.length&&(g=e.lyr[0].hcb,1!==g["class"]||1!==g.xunits&&4!==g.xunits?2!==g["class"]||1!==g.yunits&&4!==g.yunits?a.message(f,"Time = UNK"):a.message(f,"Time = "+d.sec2tod(g.timecode+e.rety),!0):a.message(f,"Time = "+d.sec2tod(g.timecode+e.retx),!0))):109===
q?g.nomenu||(h=document.createEvent("Event"),h.initEvent("showmenu",!0,!0),h.x=f.x,h.y=f.y,(h=a.dispatchEvent(f,h))&&l(c)):63===q?a.message(f,"To zoom, press and drag the left mouse (LM) over the region of interest and release. To unzoom, press right mouse (RM).  Press the middle mouse (MM) button or press the by selecting 'Keypress Info' from the main menu."):102===q?(a.fullscreen(f),c.refresh()):9===q&&e.ctrlKey?c.change_settings({invert:null}):107===q&&(g.show_marker=!g.show_marker,c.redraw())}}}(this),
setKeypressHandler(this.onkeypress));return this};e.Plot.prototype={add_plugin:function(a,d){void 0===d&&(d=Number.MAX_VALUE);if(0>=d)throw"Invalid plugin zorder";a.init(this);var c=document.createElement("canvas");c.width=this._Mx.canvas.width;c.height=this._Mx.canvas.height;this._Gx.plugins.push({impl:a,zorder:d,canvas:c});this._Gx.plugins.sort(function(a,d){return a.zorder-d.zorder});this.refresh()},remove_plugin:function(a){for(var d=this._Gx.plugins.length;d--;)this._Gx.plugins[d].impl===a&&
(a.dispose&&a.dispose(),this._Gx.plugins[d].canvas.parentNode&&this._Gx.plugins[d].canvas.parentNode.removeElement(this._Gx.plugins[d].canvas),this._Gx.plugins.splice(d,1));this._Gx.plugins.sort(function(a,d){return a.zorder-d.zorder});this.refresh()},addListener:function(d,c){a.addEventListener(this._Mx,d,c,!1)},removeListener:function(d,c){a.removeEventListener(this._Mx,d,c,!1)},change_settings:function(d){for(var c=this._Gx,e=this._Mx,f=0;f<c.lyr.length;f++)c.lyr[f].change_settings(d);void 0!==
d.grid&&(c.grid=null===d.grid?!c.grid:d.grid);void 0!==d.gridBackground&&(c.gridBackground=d.gridBackground);void 0!==d.gridStyle&&(c.gridStyle=d.gridStyle);void 0!==d.wheelZoom&&(c.wheelZoom=d.wheelZoom);void 0!==d.wheelZoomPercent&&(c.wheelZoomPercent=d.wheelZoomPercent);void 0!==d.autol&&(c.autol=d.autol);void 0!==d.index&&d.index!==c.index&&(c.index=null===d.index?!c.index:d.index,c.index&&1!==c.iabsc?c.iabsc=1:c.index||1!==c.iabsc||(c.iabsc=0),F(this,{get_data:!1},void 0,void 0),this.unzoom());
void 0!==d.all&&(c.all=null===d.all?!c.all:d.all);void 0!==d.show_x_axis&&(c.show_x_axis=null===d.show_x_axis?!c.show_x_axis:d.show_x_axis,c.specs=c.show_x_axis||c.show_y_axis||c.show_readout);void 0!==d.show_y_axis&&(c.show_y_axis=null===d.show_y_axis?!c.show_y_axis:d.show_y_axis,c.specs=c.show_x_axis||c.show_y_axis||c.show_readout);void 0!==d.show_readout&&(c.show_readout=null===d.show_readout?!c.show_readout:d.show_readout,c.specs=c.show_x_axis||c.show_y_axis||c.show_readout);void 0!==d.specs&&
(c.specs=null===d.specs?!c.specs:d.specs,c.specs?(c.show_x_axis=!0,c.show_y_axis=!0,c.show_readout=!0):(c.show_x_axis=!1,c.show_y_axis=!1,c.show_readout=!1));void 0!==d.xcnt&&(c.cntrls="leftmouse"===d.xcnt?1:"continuous"===d.xcnt?2:"disable"===d.xcnt&&0<c.cntrls?-1*c.cntrls:"enable"===d.xcnt&&0>c.cntrls?-1*c.cntrls:d.xcnt);void 0!==d.legend&&(c.legend=null===d.legend?!c.legend:d.legend);void 0!==d.pan&&(c.pan=null===d.pan?!c.pan:d.pan);void 0!==d.cross&&(c.cross=null===d.cross?!c.cross:d.cross,c.cross?
(c.cross_xpos=void 0,c.cross_ypos=void 0,z(this)):(void 0!==c.cross_xpos&&a.rubberline(e,c.cross_xpos,e.t,c.cross_xpos,e.b),void 0!==c.cross_ypos&&a.rubberline(e,e.l,c.cross_ypos,e.r,c.cross_ypos),c.cross_xpos=void 0,c.cross_ypos=void 0));void 0!==d.cmode&&E(this,d.cmode);if(void 0!==d.phunits){var g=d.phunits,f=this._Gx,h=this._Mx,k=f.plab;"R"===g?k=23:"D"===g&&(k=24);"C"===g&&(k=25);if(k!==f.plab&&(g=[Math.PI,180,0.5],g=g[k-23]/g[f.plab-23],f.plab=k,2===f.cmode)){for(k=0;k<=h.level;k++)h.stk[k].ymin*=
g,h.stk[k].ymax*=g,h.stk[k].yscl*=g;f.panymin*=g;f.panymax*=g;this.refresh()}}void 0!==d.rubberbox_action&&(c.default_rubberbox_action=d.rubberbox_action);void 0!==d.rubberbox_mode&&(c.default_rubberbox_mode=d.rubberbox_mode);void 0!==d.rightclick_rubberbox_action&&(c.default_rightclick_rubberbox_action=d.rightclick_rubberbox_action);void 0!==d.rightclick_rubberbox_mode&&(c.default_rightclick_rubberbox_mode=d.rightclick_rubberbox_mode);void 0!==d.wheelscroll_mode_natural&&(c.wheelscroll_mode_natural=
d.wheelscroll_mode_natural);void 0!==d.colors&&(d.colors.fg||(d.colors.fg=e.fg),d.colors.bg||(d.colors.bg=e.bg),a.setbgfg(e,d.colors.bg,d.colors.fg,e.xi));void 0!==d.cmap&&(c.cmap=null===d.cmap?2===c.cmode?2:1:d.cmap,p(this,c.cmap));void 0!==d.yinv&&(e.origin=d.yinv?4:1);void 0!==d.rasterSmoothing&&(c.rasterSmoothing=null===d.rasterSmoothing?!c.rasterSmoothing:d.rasterSmoothing);void 0!==d.fillStyle&&(c.fillStyle=d.fillStyle);void 0!==d.invert&&(null===d.invert?a.invertbgfg(e):!0===d.invert?a.setbgfg(this,
"white","black"):a.setbgfg(this,"black","white"));void 0!==d.nomenu&&(c.nomenu=null===d.nomenu?!c.nomenu:d.nomenu);void 0!==d.ymin&&n(this,d.ymin,e.stk[0].ymax,"Y");void 0!==d.ymax&&n(this,e.stk[0].ymin,d.ymax,"Y");void 0!==d.xmin&&n(this,d.xmin,e.stk[0].xmax,"X");void 0!==d.xmax&&n(this,e.stk[0].xmin,d.xmax,"X");void 0!==d.zmin&&(c.zmin=d.zmin,c.autoz&=2);void 0!==d.zmax&&(c.zmax=d.zmax,c.autoz&=1);void 0!==d.autoz&&(c.autoz=d.autoz,0!==(c.autoz&1)&&(c.zmin=void 0),0!==(c.autoz&2)&&(c.zmax=void 0));
void 0!==d.note&&(c.note=d.note);this.refresh();void 0!==d.pan&&K(this)},reread:function(){for(var d=this._Gx,c=[],e=0;e<d.lyr.length;e++)c[e]=d.lyr[e];e=d.HCB.slice();this.deoverlay();for(var f=0;f<e.length;f++)this.overlay_bluefile(e[f]);for(e=0;e<d.lyr.length;e++)d.lyr[e].symbol=c[e].symbol,d.lyr[e].radius=c[e].radius;this.refresh();d=document.createEvent("Event");d.initEvent("reread",!0,!0);a.dispatchEvent(this._Mx,d)},cleanup:function(){},reload:function(a,d,c,e){var f=this._Mx,g=this._Gx;0>
a||a>=g.lyr.length||void 0===g.lyr[a].reload||(a=g.lyr[a].reload(d,c),0===f.level&&F(this,{get_data:!1},a.xmin,a.xmax),e?this._refresh():this.refresh())},rescale:function(){0===this._Mx.level&&F(this,{get_data:!1},void 0,void 0);this.refresh()},push:function(a,d,c,e,f){var g=this._Mx,h=this._Gx;0>a||a>=h.lyr.length||void 0===h.lyr[a].push||(a=h.lyr[a].push(d,c,e),0===g.level&&a&&F(this,{get_data:!1}),f?this._refresh():this.refresh())},overlay_array:function(a,c,e){d.log.debug("Overlay array");a=d.initialize(a,
c);return this.overlay_bluefile(a,e)},overlay_pipe:function(a,c){d.log.debug("Overlay pipe");a||(a={});a.pipe=!0;var e=d.initialize(null,a);return this.overlay_bluefile(e,c)},overlay_websocket:function(a,c,e){d.log.debug("Overlay websocket: "+a);a=new WebSocket(a,"plot-data");a.binaryType="arraybuffer";var f=this;c||(c={});c.pipe=!0;var g=d.initialize(null,c);g.ws=a;var h=this.overlay_bluefile(g,e);a.onopen=function(a){};a.onmessage=function(a){return function(a){a.data instanceof ArrayBuffer?(a=
g.createArray(a.data),f.push(h,a)):"string"===typeof a.data&&(f._Gx.lyr[h].hcb||d.log.warning("Couldn't find header for layer "+h),a=JSON.parse(a.data),f.push(h,[],a))}}(a);return h},overlay_href:function(a,c,e){d.log.debug("Overlay href: "+a);try{this.show_spinner();var f=function(a,d){return function(c){try{if(c){var f=a.overlay_bluefile(c,e);d&&d(c,f)}else alert("Failed to load data")}finally{a.hide_spinner()}}}(this,c);(new BlueFileReader).read_http(a,f)}catch(g){console.log(g),alert("Failed to load data"),
this.hide_spinner()}},show_spinner:function(){this._Gx.spinner||(T.color=this._Mx.xwfg,this._Gx.spinner=(new Spinner(T)).spin(this._Gx.parent))},hide_spinner:function(){this._Gx.spinner&&this._Gx.spinner.stop();this._Gx.spinner=void 0},add_layer:function(d){var c=this._Gx,e=this._Mx,f=document.createEvent("Event");f.initEvent("lyradd",!0,!0);f.index=c.lyr.length;f.name=d.name;f.layer=d;a.dispatchEvent(e,f)&&c.lyr.push(d)},get_layer:function(a){var d=this._Gx;return 0<=a&&a<d.lyr.length?d.lyr[a]:null},
overlay_bluefile:function(a,c){d.log.debug("Overlay bluefile: "+a.file_name);var f=this._Mx,g=this._Gx;c=c||{};var k=0===g.HCB.length;g.HCB.push(a);1===g.HCB.length&&h(this,!0);var l=g.lyr.length;void 0===c.layerType?1===a["class"]?e.Layer1D.overlay(this,a,c):2===a["class"]&&e.Layer2D.overlay(this,a,c):"1D"===c.layerType?e.Layer1D.overlay(this,a,c):"2D"===c.layerType?e.Layer2D.overlay(this,a,c):c.layerType.overlay(this,a,c);E(this,g.cmode);if(k||c.expand)if(0===g.HCB.length)h(this,!1);else{g.basemode=
g.cmode;var n,p;0===(g.autox&&1)&&(n=g.xmin);0===(g.autox&&2)&&(p=g.xmin);F(this,{get_data:!0},n,p);f.level=0;0!==(g.autox&&1)&&(g.xmin=f.stk[0].xmin);0!==(g.autox&&2)&&(g.xmax=f.stk[0].xmax);0!==(g.autoy&&1)&&(g.ymin=f.stk[0].ymin);0!==(g.autoy&&2)&&(g.ymax=f.stk[0].ymax);f.resize=!0;f.origin=g.lyr[0].preferred_origin?g.lyr[0].preferred_origin:1}else for(f=l;f<g.lyr.length;f++)u(this,f);t(this);this.refresh();return g.HCB.length-1},load_files:function(a,d){for(var c=function(a){return function(c){a.overlay_bluefile(c,
d)}}(this),e=0;e<a.length;e++){var f=a[e];(new BlueFileReader).read(f,c)}},deoverlay:function(a){var d=this._Gx;if(0<d.HCB.length)if(void 0===a)for(a=d.HCB.length-1;0<=a;a--)this.remove_layer(a);else if(0>a){a=d.HCB.length+a;if(0>a)return;this.remove_layer(a)}else a<d.HCB.length&&this.remove_layer(a);0===d.lyr.length&&(h(this,!1),F(this,{}))},remove_layer:function(d){var c=this._Gx,e="",f=null;if(0<=d&&d<c.HCB.length){e=c.HCB[d].file_name;f=c.HCB[d];for(c.HCB[d]=null;d<c.HCB.length-1;d++)c.HCB[d]=
c.HCB[d+1];c.HCB.length-=1}for(d=c.lyr.length-1;0<=d;d--)if(c.lyr[d].hcb===f){var g=d,h=this._Gx,k=this._Mx,l=document.createEvent("Event");l.initEvent("lyrdel",!0,!0);l.index=g;l.name=h.lyr[g].name;l.layer=h.lyr[g];if(a.dispatchEvent(k,l)){h.lyr[g].ybufn=0;h.lyr[g].ybuf=null;if(g<h.lyr.length-1)for(;g<h.lyr.length-1;g++)h.lyr[g]=h.lyr[g+1];h.lyr.length-=1;0<h.HCB.length&&(h.panxmin=1,h.panxmax=-1,h.panymin=1,h.panymax=-1)}}t(this);this.refresh();c=document.createEvent("Event");c.initEvent("file_deoverlayed",
!0,!0);""!==e&&(c.fileName=e);a.dispatchEvent(this._Mx,c)},pixel_zoom:function(a,d,c,e,f){a=V(this,a,d);c=V(this,c,e);this.zoom(a,c,f)},percent_zoom:function(a,d,c){var e=this._Mx,f=this._Gx,g=0;1>Math.abs(a)&&(g=Math.abs(e.stk[e.level].xmax-e.stk[e.level].xmin),g=g*a/2);a=0;1>Math.abs(d)&&(a=Math.abs(e.stk[e.level].ymax-e.stk[e.level].ymin),a=a*d/2);d={x:Math.max(e.stk[e.level].xmin+g,f.panxmin),y:Math.max(e.stk[e.level].ymin+a,f.panymin)};e={x:Math.min(e.stk[e.level].xmax-g,f.panxmax),y:Math.min(e.stk[e.level].ymax-
a,f.panymax)};this.zoom(d,e,c)},zoom:function(d,c,e){var f=this._Mx,g=this._Gx;if(!(9<=f.level)){void 0===d.x&&(d.x=f.stk[f.level].xmin);void 0===d.y&&(d.y=f.stk[f.level].ymin);void 0===c.x&&(c.x=f.stk[f.level].xmax);void 0===c.y&&(c.y=f.stk[f.level].ymax);if(c.x<d.x){var h=c.x;c.x=d.x;d.x=h}c.y<d.y&&(h=c.y,c.y=d.y,d.y=h);h={};h.xscl=f.stk[f.level].xscl;h.yscl=f.stk[f.level].yscl;h.xmin=d.x;h.xmax=c.x;h.ymin=d.y;h.ymax=c.y;g.index&&(h.xmin=Math.min(h.xmin/g.xdelta),h.xmax=Math.min(h.xmax/g.xdelta));
e&&g.inContinuousZoom?f.stk[f.level]=h:(f.stk.push(h),f.level=f.stk.length-1);g.inContinuousZoom=e;this.inZoom=!0;d=document.createEvent("Event");d.initEvent("zoom",!0,!0);d.level=f.level;d.inContinuousZoom=g.inContinuousZoom;d.xmin=f.stk[f.level].xmin;d.ymin=f.stk[f.level].ymin;d.xmax=f.stk[f.level].xmax;d.ymax=f.stk[f.level].ymax;a.dispatchEvent(f,d);this.inZoom=!1;this.refresh()}},unzoom:function(d){var c=this._Mx,e=this._Gx;if(0!==c.level){d||(d=c.stk.length);for(;0<d&&0!==c.level;)c.stk.pop(),
c.level=c.stk.length-1,d-=1;0===c.level&&this.rescale();e.inContinuousZoom=!1;this.inZoom=!0;d=document.createEvent("Event");d.initEvent("unzoom",!0,!0);d.level=c.level;d.xmin=c.stk[c.level].xmin;d.ymin=c.stk[c.level].ymin;d.xmax=c.stk[c.level].xmax;d.ymax=c.stk[c.level].ymax;a.dispatchEvent(c,d);this.inZoom=!1;this.refresh()}},mimic:function(a,d){var c=this;if(!d)throw"mimic must be called with at least one event mask";d.zoom?a.addListener("zoom",function(a){c.inZoom||c.zoom({x:a.xmin,y:a.ymin},
{x:a.xmax,y:a.ymax},a.inContinuousZoom)}):d.xzoom?a.addListener("zoom",function(a){c.inZoom||c.zoom({x:a.xmin,y:void 0},{x:a.xmax,y:void 0},a.inContinuousZoom)}):d.yzoom&&a.addListener("zoom",function(a){c.inZoom||c.zoom({x:void 0,y:a.ymin},{x:void 0,y:a.ymax},a.inContinuousZoom)});d.unzoom&&a.addListener("unzoom",function(a){c.inZoom||a.level<c._Mx.level&&c.unzoom(c._Mx.level-a.level)});(d.pan||d.xpan)&&a.addListener("xpan",function(a){c.inPan||n(c,a.xmin,a.xmax,"X")});(d.pan||d.ypan)&&a.addListener("ypan",
function(a){c.inPan||n(c,a.ymin,a.ymax,"Y")})},redraw:function(){var a=this._Gx,d=this._Mx,c=d.canvas.getContext("2d");a.plotData.valid?(c.drawImage(a.plotData,d.l-1,d.t-1,d.r-d.l+2,d.b-d.t+2,d.l-1,d.t-1,d.r-d.l+2,d.b-d.t+2),B(this),a.cross_xpos=void 0,a.cross_ypos=void 0,z(this),(a.always_show_marker||a.show_marker)&&A(this)):this.refresh()},refresh:function(){var d=this;a.render(this._Mx,function(){d._refresh()})},enable_listeners:function(){var d=this._Mx;a.addEventListener(d,"mousedown",this.onmousedown,
!1);a.addEventListener(d,"mousemove",this.throttledOnMouseMove,!1);document.addEventListener("mouseup",this.docMouseUp,!1);a.addEventListener(d,"mouseup",this.mouseup,!1);window.addEventListener("mousedown",this.dragMouseDownHandler,!1);window.addEventListener("mousemove",this.throttledDragOnMouseMove,!1);window.addEventListener("mouseup",this.dragMouseUpHandler,!1);window.addEventListener("wheel",this.wheelHandler,!1);window.addEventListener("mousewheel",this.wheelHandler,!1);window.addEventListener("DOMMouseScroll",
this.wheelHandler,!1);window.addEventListener("keypress",this.onkeypress,!1)},disable_listeners:function(){var d=this._Mx;a.removeEventListener(d,"mousedown",this.onmousedown,!1);a.removeEventListener(d,"mousemove",this.throttledOnMouseMove,!1);document.removeEventListener("mouseup",this.docMouseUp,!1);a.removeEventListener(d,"mouseup",this.mouseup,!1);window.removeEventListener("mousedown",this.dragMouseDownHandler,!1);window.removeEventListener("mousemove",this.throttledDragOnMouseMove,!1);window.removeEventListener("mouseup",
this.dragMouseUpHandler,!1);window.removeEventListener("wheel",this.wheelHandler,!1);window.removeEventListener("mousewheel",this.wheelHandler,!1);window.removeEventListener("DOMMouseScroll",this.wheelHandler,!1);window.removeEventListener("keypress",this.onkeypress,!1)},checkresize:function(){a.checkresize(this._Mx)&&this.refresh()},_refresh:function(){var c=this._Mx,e=this._Gx;c.canvas.getContext("2d");if(!e.hold){a.set_font(c,Math.min(8,c.width/64));e.pthk=1.5*c.text_w;if(e.specs){var f=!1;4===
e.ylab&&(f=!0);!0===e.show_y_axis?(c.l=6*c.text_w,f&&(31536E3<=Math.abs(c.stk[0].ymin)||31536E3<=Math.abs(c.stk[0].ymax))&&(c.l=11*c.text_w)):c.l=1;c.r=!0===e.pan?c.width-(e.pthk+2*c.text_w):c.width-2;e.show_readout?(c.t=2*c.text_h,c.b=e.show_x_axis?c.height-4*c.text_h:c.height-3*c.text_h):(c.t=e.pan?e.pthk+2*c.text_w:1,c.b=e.show_x_axis?c.height-3*c.text_h/2:c.height-2);e.pl=e.show_readout?50*c.text_w:35*c.text_w;e.pr=Math.max(e.pl+9*c.text_w,c.r);e.pt=e.show_readout?e.show_x_axis?c.b+c.text_h+(c.height-
c.b-c.text_h-e.pthk)/2:c.b+(c.height-c.b-e.pthk)/2:(c.t-e.pthk)/2;e.lbtn=c.text_h+c.text_w+2}else e.pan?(c.t=e.pthk+2*c.text_w,c.r=c.width-(e.pthk+c.text_w)):(c.t=1,c.r=c.width-2),c.b=c.height-2,c.l=1,e.pl=c.l,e.pr=c.r,e.pt=(c.t-e.pthk)/2,e.lbtn=0;e.pyl=c.r+(c.width-c.r-e.pthk)/2+1;f=c.level;c.stk[f].x1=c.l;c.stk[f].y1=c.t;c.stk[f].x2=c.r;c.stk[f].y2=c.b;c.stk[f].xscl=(c.stk[f].xmax-c.stk[f].xmin)/(c.r-c.l);c.stk[f].yscl=(c.stk[f].ymax-c.stk[f].ymin)/(c.b-c.t);f=V(this,c.xpos,c.ypos);e.retx=f.x;e.rety=
f.y;if(0===e.panning||0!==e.panning)e.plotData.valid=!1,a.clear_window(c);var f=e.xlab,g=e.ylab;void 0===f&&(f=30);e.index&&(f=0);void 0===g&&(g=0<e.lyr.length&&e.lyr[0].cx,1===e.cmode?g=28:2===e.cmode?g=e.plab:3===e.cmode&&g?g=21:4===e.cmode?g=22:5===e.cmode?(g=22,f=21):g=6===e.cmode?26:7===e.cmode?27:0);if(e.specs){if(0===e.sections){var h={grid:e.grid};2===e.panning&&(h.noxtlab=!0);e.show_x_axis||(h.noxtics=!0,h.noxtlab=!0,h.noxplab=!0);e.show_y_axis||(h.noytics=!0,h.noytlab=!0,h.noyplab=!0);!e.specs||
e.show_readout||e.pan||(h.noyplab=!0,h.noxplab=!0);e.gridBackground&&(h.fillStyle=e.gridBackground);e.gridStyle&&(h.gridStyle=e.gridStyle);e.xmult&&(h.xmult=e.xmult);e.ymult&&(h.ymult=e.ymult);a.drawaxis(c,e.xdiv,e.ydiv,f,g,h)}f=e.lbtn-2;e.show_readout&&e.pan?(e.legend?(e.legendBtnLocation={x:c.width-e.lbtn,y:2,width:f,height:f},a.shadowbox(c,c.width-e.lbtn,2,f,f,1,-2,"L")):(e.legendBtnLocation={x:c.width-e.lbtn,y:2,width:f,height:f},a.shadowbox(c,c.width-e.lbtn,2,f,f,1,2,"L")),K(this)):e.legendBtnLocation=
null}else e.grid&&0<=e.sections&&(h={grid:!0,noaxisbox:!0,noxtics:!0,noxtlab:!0,noxplab:!0,noytics:!0,noytlab:!0,noyplab:!0},a.drawaxis(c,e.xdiv,e.ydiv,f,g,h));for(f=0;f<e.lyr.length;f++)u(this,f);f=this._Mx;g=this._Gx;g.show_readout&&!g.hide_note&&a.text(f,f.width-g.lbtn-(g.note.length+1)*f.text_w,f.text_h,g.note);I(this);if(g.legend){for(var f=this._Mx,g=this._Gx,h=f.canvas.getContext("2d"),k=0,l=0,n=0,p=0,t=0,v=0,w=0,x=k=0,y=0,p=f.text_w,w=23*p,k=(g.lyr.length+1)*f.text_h,t=f.r-w,v=f.t,l=t+2,n=
v+2,x=w-5,y=k-5,E=0,k=w=0;k<g.lyr.length;k++){var F=h.measureText(g.lyr[k].name).width;F>E&&(E=F)}98<E&&(w=E-98,x+=w,l-=w);h.strokeStyle=f.fg;h.fillStyle=f.bg;h.fillRect(l,n,x,y);h.strokeRect(l,n,x,y);for(k=0;k<g.lyr.length;k++)l=t+4*p,n=v+k*f.text_h+f.text_h,k===g.modlayer&&a.text(f,t+p-w,n+Math.floor(f.text_w/2),"**"),g.lyr[k].display&&(y=g.lyr[k].color,0<g.lyr[k].line&&(x=d.sign(Math.min(p,Math.abs(g.lyr[k].thick)),g.lyr[k].thick),0>x||x===a.L_dashed?a.draw_line(f,y,l-w,n-3,l+2*p-w,n-3,Math.abs(x),
{mode:"dashed",on:4,off:4}):a.draw_line(f,y,l-w,n-3,l+2*p-w,n-3,Math.abs(x))),0<g.lyr[k].symbol&&(x=0>g.lyr[k].radius?-d.trunc(0.6*p):Math.min(g.lyr[k].radius,d.trunc(0.6*p)),a.draw_symbol(f,y,l+p-w,n-3,g.lyr[k].symbol,x))),l+=3*p,n+=0.3*f.text_h,a.text(f,l-w,n,g.lyr[k].name)}c.r>c.l&&c.b>c.t&&(e.plotData.width=c.canvas.width,e.plotData.height=c.canvas.height,e.plotData.getContext("2d").drawImage(c.canvas,0,0),e.plotData.valid=!0);B(this);e.cross_xpos=void 0;e.cross_ypos=void 0;z(this);(e.always_show_marker||
e.show_marker)&&A(this)}}};var T={lines:13,length:7,width:4,radius:10,corners:1,rotate:0,color:"#FFF",speed:1,trail:60,shadow:!1,hwaccel:!1,className:"spinner",zIndex:2E9,top:"auto",left:"auto"},x="Ma Ph Re Im IR Lo L2".split(" "),W=["(absc)","(indx)","(1/ab)","(dydx)"]})(window.sigplot,window.mx,window.m);

(function(l,g,r,d){l.AnnotationPlugin=function(a){this.options=a===d?{}:a;this.options.display===d&&(this.options.display=!0);this.options.textBaseline=this.options.textBaseline||"alphabetic";this.options.textAlign=this.options.textAlign||"left";this.annotations=[]};l.AnnotationPlugin.prototype={init:function(a){var c=this;this.plot=a;var b=this.plot._Mx;this.onmousemove=function(a){if(0!==c.annotations.length&&!c.options.prevent_hover)if(a.xpos<b.l||a.xpos>b.r)c.set_highlight(!1);else if(a.ypos>
b.b||a.ypos<b.t)c.set_highlight(!1);else{for(var h=!1,e=0;e<c.annotations.length;e++){var f=c.annotations[e],n=d,p=d;f.absolute_placement&&(n=f.x,p=f.y);f.pxl_x!==d&&(n=f.pxl_x);f.pxl_y!==d&&(p=f.pxl_y);var l=g.real_to_pixel(b,f.x,f.y);n===d&&(n=l.x);p===d&&(p=l.y);var l=n,q=p;f.value instanceof HTMLImageElement||f.value instanceof HTMLCanvasElement||f.value instanceof HTMLVideoElement?(l-=f.width/2,q-=f.height/2):q-=f.height;g.inrect(a.xpos,a.ypos,l,q,f.width,f.height)?f.highlight||(c.set_highlight(!0,
[f],n,p),h=!0):(f.highlight&&(c.set_highlight(!1,[f]),h=!0),f.selected=d)}c.plot&&h&&c.plot.refresh()}};this.plot.addListener("mmove",this.onmousemove);this.onmousedown=function(b){for(b=0;b<c.annotations.length;b++)c.annotations[b].highlight&&(c.annotations[b].selected=!0)};this.plot.addListener("mdown",this.onmousedown);this.onmouseup=function(b){for(var a=0;a<c.annotations.length;a++){if(c.annotations[a].selected&&(b=document.createEvent("Event"),b.initEvent("annotationclick",!0,!0),b.annotation=
c.annotations[a],g.dispatchEvent(c.plot._Mx,b)&&c.annotations[a].onclick))c.annotations[a].onclick();c.annotations[a].selected=d}};document.addEventListener("mouseup",this.onmouseup,!1)},set_highlight:function(a,c,b,k){c=c||this.annotations;for(var d=0;d<c.length;d++){var e=document.createEvent("Event");e.initEvent("annotationhighlight",!0,!0);e.annotation=c[d];e.state=a;e.x=b;e.y=k;g.dispatchEvent(this.plot._Mx,e)&&(c[d].highlight=a)}},menu:function(){var a=function(b){return function(){b.options.display=
!b.options.display;b.plot.redraw()}}(this),c=function(b){return function(){b.annotations=[];b.plot.redraw()}}(this);return{text:"Annotations...",menu:{title:"ANNOTATIONS",items:[{text:"Display",checked:this.options.display,style:"checkbox",handler:a},{text:"Clear All",handler:c}]}}},add_annotation:function(a){this.annotations.push(a);this.plot.redraw();return this.annotations.length},clear_annotations:function(){this.annotations=[];this.plot.redraw()},refresh:function(a){if(this.options.display){var c=
this.plot._Mx,b=a.getContext("2d"),k=this;b.save();b.beginPath();b.rect(c.l,c.t,c.r-c.l,c.b-c.t);b.clip();g.onCanvas(c,a,function(){for(var a=k.annotations.length-1;0<=a;a--){var e=k.annotations[a],f=d,n=d;e.absolute_placement&&(f=e.x,n=e.y);e.pxl_x!==d&&(f=e.pxl_x);e.pxl_y!==d&&(n=e.pxl_y);var l=g.real_to_pixel(c,e.x,e.y);f===d&&(f=l.x);n===d&&(n=l.y);g.inrect(f,n,c.l,c.t,c.r-c.l,c.b-c.t)&&(e.value instanceof HTMLImageElement||e.value instanceof HTMLCanvasElement||e.value instanceof HTMLVideoElement?
(e.width=e.value.width,e.height=e.value.height,b.drawImage(e.value,f-e.width/2,n-e.height/2)):(b.font=e.font||"bold italic 20px new century schoolbook",b.fillStyle=e.highlight?e.highlight_color||c.hi:e.color||c.fg,b.globalAlpha=1,e.width=b.measureText(e.value).width,e.height=b.measureText("M").width,b.textBaseline=e.textBaseline||k.options.textBaseline,b.textAlign=e.textAlign||k.options.textAlign,b.fillText(e.value,f,n)),e.highlight&&e.popup&&g.render_message_box(c,e.popup,f+5,n+5,e.popupTextColor))}});
b.restore()}},dispose:function(){this.annotations=this.plot=d}}})(window.sigplot=window.sigplot||{},mx,m);
(function(l,g,r,d){l.SliderPlugin=function(a){this.options=a!==d?a:{};this.options.display===d&&(this.options.display=!0);this.options.style===d&&(this.options.style={});this.options.direction===d&&(this.options.direction="vertical");this.paired_slider=this.location=this.position=d};l.SliderPlugin.prototype={init:function(a){this.plot=a;var c=a._Mx,b=this;this.onmousemove=function(a){if(b.location!==d&&!b.options.prevent_drag)if(a.xpos<c.l||a.xpos>c.r)b.set_highlight(!1);else if(a.ypos>c.b||a.ypos<
c.t)b.set_highlight(!1);else{var h=b.options.style.lineWidth!==d?b.options.style.lineWidth:1;b.dragging?(h=g.pixel_to_real(c,a.xpos,a.ypos),"vertical"===b.options.direction?(b.location=a.xpos,b.position=h.x):"horizontal"===b.options.direction?(b.location=a.ypos,b.position=h.y):"both"===b.options.direction&&(b.location.x=a.xpos,b.position.x=h.x,b.location.y=a.ypos,b.position.y=h.y),b.plot.redraw(),a.preventDefault()):c.warpbox||("vertical"===b.options.direction?Math.abs(b.location-a.xpos)<h+5?b.set_highlight(!0):
b.set_highlight(!1):"horizontal"===b.options.direction?Math.abs(b.location-a.ypos)<h+5?b.set_highlight(!0):b.set_highlight(!1):"both"===b.options.direction&&(Math.abs(b.location.x-a.xpos)<h+5&&Math.abs(b.location.y-a.ypos)<h+5?b.set_highlight(!0):b.set_highlight(!1)))}};this.plot.addListener("mmove",this.onmousemove);this.onmousedown=function(a){if(b.location!==d&&!(b.options.prevent_drag||a.xpos<c.l||a.xpos>c.r||a.ypos>c.b||a.ypos<c.t||a.slider_drag)){var h=b.options.style.lineWidth!==d?b.options.style.lineWidth:
1;"vertical"===b.options.direction?Math.abs(b.location-a.xpos)<h+5&&(b.dragging=!0,a.slider_drag=!0,a.preventDefault()):"horizontal"===b.options.direction?Math.abs(b.location-a.ypos)<h+5&&(b.dragging=!0,a.slider_drag=!0,a.preventDefault()):"both"===b.options.direction&&Math.abs(b.location.x-a.xpos)<h+5&&Math.abs(b.location.y-a.ypos)<h+5&&(b.dragging=!0,a.slider_drag=!0,a.preventDefault())}};this.plot.addListener("mdown",this.onmousedown);this.onmouseup=function(a){b.dragging&&(b.dragging=!1,a=document.createEvent("Event"),
a.source=b,a.initEvent("slidertag",!0,!0),"both"===b.options.direction?(a.location=b.location?JSON.parse(JSON.stringify(b.location)):d,a.position=b.position?JSON.parse(JSON.stringify(b.position)):d):(a.location=b.location,a.position=b.position),g.dispatchEvent(c,a),a=document.createEvent("Event"),a.initEvent("sliderdrag",!0,!0),"both"===b.options.direction?(a.location=b.location?JSON.parse(JSON.stringify(b.location)):d,a.position=b.position?JSON.parse(JSON.stringify(b.position)):d):(a.location=b.location,
a.position=b.position),g.dispatchEvent(c,a))};document.addEventListener("mouseup",this.onmouseup,!1)},addListener:function(a,c){var b=this;g.addEventListener(this.plot._Mx,a,function(a){if(a.source===b)return c(a)},!1)},removeListener:function(a,c){g.removeEventListener(this.plot._Mx,a,c,!1)},pair:function(a){if(a){if(a.direction!==this.direction)throw"paired sliders must use the same direction setting";this.paired_slider=a}else this.paired_slider=null},set_highlight:function(a){a!==this.highlight&&
(this.highlight=a,this.plot.redraw())},set_position:function(a){if(!this.dragging){if("both"===this.options.direction){if(this.position!==d&&this.position.x===a.x&&this.position.y===a.y)return}else if(this.position===a)return;this.set_highlight(!1);var c=this.plot._Mx;this.position="both"===this.options.direction?a?JSON.parse(JSON.stringify(a)):d:a;a="both"===this.options.direction?g.real_to_pixel(c,this.position.x,this.position.y):g.real_to_pixel(c,this.position,this.position);"vertical"===this.options.direction?
this.location=a.x:"horizontal"===this.options.direction?this.location=a.y:"both"===this.options.direction&&(this.location={x:a.x,y:a.y});a=document.createEvent("Event");a.initEvent("slidertag",!0,!0);"both"===this.options.direction?(a.location=this.location?JSON.parse(JSON.stringify(this.location)):d,a.position=this.position?JSON.parse(JSON.stringify(this.position)):d):(a.location=this.location,a.position=this.position);g.dispatchEvent(c,a);this.plot.redraw()}},set_location:function(a){if(!this.dragging){if("both"===
this.options.direction){if(this.location!==d&&this.location.x===a.x&&this.location.y===a.y)return}else if(this.location===a)return;this.set_highlight(!1);var c=this.plot._Mx;this.location="both"===this.options.direction?a?JSON.parse(JSON.stringify(a)):d:a;a="both"===this.options.direction?g.pixel_to_real(c,a.x,a.y):g.pixel_to_real(c,a,a);"vertical"===this.options.direction?this.position=a.x:"horizontal"===this.options.direction?this.position=a.y:"both"===this.options.direction&&(this.position={x:a.x,
y:a.y});a=document.createEvent("Event");a.initEvent("slidertag",!0,!0);"both"===this.options.direction?(a.location=this.location?JSON.parse(JSON.stringify(this.location)):d,a.position=this.position?JSON.parse(JSON.stringify(this.position)):d):(a.location=this.location,a.position=this.position);g.dispatchEvent(c,a);this.plot.redraw()}},get_position:function(){return this.position},get_location:function(){return this.location},refresh:function(a){if(this.options.display&&this.position!==d){var c=this.plot._Mx;
a=a.getContext("2d");a.lineWidth=this.options.style.lineWidth!==d?this.options.style.lineWidth:1;a.lineCap=this.options.style.lineCap!==d?this.options.style.lineCap:"square";a.strokeStyle=this.options.style.strokeStyle!==d?this.options.style.strokeStyle:c.fg;if(this.dragging||this.highlight)a.lineWidth=Math.ceil(1.2*a.lineWidth);var b;b="both"===this.options.direction?g.real_to_pixel(c,this.position.x,this.position.y):g.real_to_pixel(c,this.position,this.position);if("vertical"===this.options.direction){if(b.x<
c.l||b.x>c.r)return;this.location=b.x}else if("horizontal"===this.options.direction){if(b.y<c.t||b.y>c.b)return;this.location=b.y}else if("both"===this.options.direction){if(b.x<c.l||b.x>c.r||b.y<c.t||b.y>c.b)return;this.location.x=b.x;this.location.y=b.y}"vertical"===this.options.direction?(a.beginPath(),a.moveTo(this.location+0.5,c.t),a.lineTo(this.location+0.5,c.b),a.stroke()):"horizontal"===this.options.direction?(a.beginPath(),a.moveTo(c.l,this.location+0.5),a.lineTo(c.r,this.location+0.5),a.stroke()):
"both"===this.options.direction&&(a.beginPath(),a.moveTo(c.l,this.location.y+0.5),a.lineTo(c.r,this.location.y+0.5),a.closePath(),a.moveTo(this.location.x+0.5,c.t),a.lineTo(this.location.x+0.5,c.b),a.stroke());if(this.dragging||this.highlight){if("vertical"===this.options.direction){a.textBaseline="alphabetic";a.textAlign="left";a.fillStyle=this.options.style.textStyle!==d?this.options.style.textStyle:c.fg;a.font=c.font.font;b=g.format_g(this.position,6,3,!0).trim();var k=a.measureText(b).width;this.location+
5+k>c.r?(a.textAlign="right",a.fillText(b,this.location-5,c.t+10)):a.fillText(b,this.location+5,c.t+10)}else"horizontal"===this.options.direction&&(a.textBaseline="alphabetic",a.textAlign="left",a.fillStyle=this.options.style.textStyle!==d?this.options.style.textStyle:c.fg,a.font=c.font.font,b=g.format_g(this.position,6,3,!0).trim(),this.location-c.text_h-5>c.t?a.fillText(b,c.l+10,this.location-5):a.fillText(b,c.l+10,this.location+5+c.text_h));if(this.paired_slider)if("vertical"===this.options.direction){b=
this.position-this.paired_slider.position;var k=this.location-this.paired_slider.location,h=c.t+Math.round((c.b-c.t)/2);g.textline(c,this.location,h,this.paired_slider.location,h,{mode:"dashed",on:3,off:3});a.textBaseline="alphabetic";a.textAlign="center";a.fillStyle=this.options.style.textStyle!==d?this.options.style.textStyle:c.fg;a.font=c.font.font;b=g.format_g(b,6,3,!0);a.fillText(b,this.location-Math.round(k/2),h-5)}else"horizontal"===this.options.direction&&(b=this.position-this.paired_slider.position,
k=this.location-this.paired_slider.location,h=c.l+Math.round((c.r-c.l)/2),g.textline(c,h,this.location,h,this.paired_slider.location,{mode:"dashed",on:3,off:3}),a.textBaseline="alphabetic",a.textAlign="left",a.fillStyle=this.options.style.textStyle!==d?this.options.style.textStyle:c.fg,a.font=c.font.font,b=g.format_g(b,6,3,!0),a.fillText(b,h+5,this.location-Math.round(k/2)))}}},dispose:function(){this.plot.removeListener("mmove",this.onmousemove);document.removeEventListener("mouseup",this.onmouseup,
!1);this.position=this.plot=d}}})(window.sigplot=window.sigplot||{},mx,m);
(function(l,g,r,d){l.AccordionPlugin=function(a){this.options=a!==d?a:{};this.options.display===d&&(this.options.display=!0);this.options.center_line_style===d&&(this.options.center_line_style={});this.options.edge_line_style===d&&(this.options.edge_line_style={});this.options.fill_style===d&&(this.options.fill_style={});this.options.direction===d&&(this.options.direction="vertical");this.options.mode===d&&(this.options.mode="absolute");this.loc_2=this.loc_1=this.center_location=this.width=this.center=
d;this.visible=!0};l.AccordionPlugin.prototype={init:function(a){this.plot=a;var c=this.plot._Mx,b=this;this.onmousemove=function(a){if(b.center_location!==d&&!b.options.prevent_drag)if(a.xpos<c.l||a.xpos>c.r)b.set_highlight(!1);else if(a.ypos>c.b||a.ypos<c.t)b.set_highlight(!1);else{var h=b.options.center_line_style.lineWidth!==d?b.options.center_line_style.lineWidth:1,e=b.options.edge_line_style.lineWidth!==d?b.options.edge_line_style.lineWidth:1;b.dragging||b.edge_dragging?(b.dragging&&(h=g.pixel_to_real(c,
a.xpos,a.ypos),"vertical"===b.options.direction?(b.center_location=a.xpos,"absolute"===b.options.mode?b.center=h.x:"relative"===b.options.mode&&(b.center=(a.xpos-c.l)/(c.r-c.l))):"horizontal"===b.options.direction&&(b.center_location=a.ypos,"absolute"===b.options.mode?b.center=h.y:"relative"===b.options.mode&&(b.center=(a.ypos-c.t)/(c.b-c.t)))),b.edge_dragging&&(h=g.pixel_to_real(c,a.xpos,a.ypos),"vertical"===b.options.direction?"absolute"===b.options.mode?b.width=2*Math.abs(b.center-h.x):"relative"===
b.options.mode&&(b.width=2*Math.abs(b.center_location-a.xpos)/(c.r-c.l)):"horizontal"===b.options.direction&&("absolute"===b.options.mode?b.width=2*Math.abs(b.center-h.y):"relative"===b.options.mode&&(b.width=2*Math.abs(b.center_location-a.ypos)/(c.b-c.t)))),b.plot&&b.plot.refresh(),a.preventDefault()):c.warpbox||("vertical"===b.options.direction?(Math.abs(b.center_location-a.xpos)<h+5?b.set_highlight(!0):b.set_highlight(!1),Math.abs(b.loc_1-a.xpos)<e+5||Math.abs(b.loc_2-a.xpos)<e+5?b.set_edge_highlight(!0):
b.set_edge_highlight(!1)):"horizontal"===b.options.direction&&(Math.abs(b.center_location-a.ypos)<h+5?b.set_highlight(!0):b.set_highlight(!1),Math.abs(b.loc_1-a.ypos)<e+5||Math.abs(b.loc_2-a.ypos)<e+5?b.set_edge_highlight(!0):b.set_edge_highlight(!1)))}};this.plot.addListener("mmove",this.onmousemove);this.onmousedown=function(a){if(b.center_location!==d&&!(a.xpos<c.l||a.xpos>c.r||a.ypos>c.b||a.ypos<c.t)){var h=b.options.center_line_style.lineWidth!==d?b.options.center_line_style.lineWidth:1,e=b.options.edge_line_style.lineWidth!==
d?b.options.edge_line_style.lineWidth:1;"vertical"===b.options.direction?Math.abs(b.loc_1-a.xpos)<e+5||Math.abs(b.loc_2-a.xpos)<e+5?(b.edge_dragging=!0,a.preventDefault()):Math.abs(b.center_location-a.xpos)<h+5&&(b.dragging=!0,a.preventDefault()):"horizontal"===b.options.direction&&(Math.abs(b.loc_1-a.ypos)<e+5||Math.abs(b.loc_2-a.ypos)<e+5?(b.edge_dragging=!0,a.preventDefault()):Math.abs(b.center_location-a.ypos)<h+5&&(b.dragging=!0,a.preventDefault()))}};this.plot.addListener("mdown",this.onmousedown);
this.onmouseup=function(a){b.dragging=!1;b.edge_dragging=!1;a=document.createEvent("Event");a.initEvent("accordiontag",!0,!0);a.center=b.center;a.width=b.width;g.dispatchEvent(c,a)};document.addEventListener("mouseup",this.onmouseup,!1)},addListener:function(a,c){g.addEventListener(this.plot._Mx,a,c,!1)},removeListener:function(a,c){g.removeEventListener(this.plot._Mx,a,c,!1)},set_highlight:function(a){a!==this.highlight&&(this.highlight=a,this.plot.redraw())},set_edge_highlight:function(a){a!==this.edge_highlight&&
(this.edge_highlight=a,this.plot.redraw())},set_center:function(a){this.center=a;if(this.plot){a=this.plot._Mx;var c=document.createEvent("Event");c.initEvent("accordiontag",!0,!0);c.center=this.center;c.width=this.width;g.dispatchEvent(a,c);this.plot.redraw()}},set_width:function(a){this.width=a;if(this.plot){a=this.plot._Mx;var c=document.createEvent("Event");c.initEvent("accordiontag",!0,!0);c.center=this.center;c.width=this.width;g.dispatchEvent(a,c);this.plot.redraw()}},get_center:function(){return this.center},
get_width:function(){return this.width},refresh:function(a){if(this.plot&&this.visible&&this.options.display&&this.center!==d&&this.width!==d){var c=this.plot._Mx,b=a.getContext("2d");b.clearRect(0,0,a.width,a.height);var k;"absolute"===this.options.mode?k=g.real_to_pixel(c,this.center,this.center):"relative"===this.options.mode&&("vertical"===this.options.direction?(k=c.stk[0].x1+(c.stk[0].x2-c.stk[0].x1)*this.center,k=g.real_to_pixel(c,g.pixel_to_real(c,k,k).x,g.pixel_to_real(c,k,k).y)):"horizontal"===
this.options.direction&&(k=c.stk[0].y1+(c.stk[0].y2-c.stk[0].y1)*this.center,k=g.real_to_pixel(c,g.pixel_to_real(c,k,k).x,g.pixel_to_real(c,k,k).y)));var h,e;"absolute"===this.options.mode?(h=g.real_to_pixel(c,this.center-this.width/2,this.center-this.width/2),e=g.real_to_pixel(c,this.center+this.width/2,this.center+this.width/2)):"relative"===this.options.mode&&(e=c.stk[0].x2-c.stk[0].x1,a=c.stk[0].y2-c.stk[0].y1,h={x:k.x-this.width*e/2,y:k.y-this.width*a/2},e={x:k.x+this.width*e/2,y:k.y+this.width*
a/2});"vertical"===this.options.direction?(this.center_location=k.x,this.loc_1=Math.max(c.l,h.x),this.loc_2=Math.min(c.r,e.x)):"horizontal"===this.options.direction&&(this.center_location=k.y,this.loc_1=Math.max(c.t,e.y),this.loc_2=Math.min(c.b,h.y));this.options.shade_area&&0<Math.abs(this.loc_2-this.loc_1)&&(h=b.globalAlpha,b.globalAlpha=this.options.fill_style.opacity!==d?this.options.fill_style.opacity:0.4,b.fillStyle=this.options.fill_style.fillStyle!==d?this.options.fill_style.fillStyle:c.hi,
"vertical"===this.options.direction?b.fillRect(this.loc_1,c.t,this.loc_2-this.loc_1,c.b-c.t):"horizontal"===this.options.direction&&b.fillRect(c.l,this.loc_1,c.r-c.l,this.loc_2-this.loc_1),b.globalAlpha=h);if(this.options.draw_edge_lines||this.edge_highlight||this.edge_dragging){b.lineWidth=this.options.edge_line_style.lineWidth!==d?this.options.edge_line_style.lineWidth:1;b.lineCap=this.options.edge_line_style.lineCap!==d?this.options.edge_line_style.lineCap:"square";b.strokeStyle=this.options.edge_line_style.strokeStyle!==
d?this.options.edge_line_style.strokeStyle:c.fg;if(this.edge_dragging||this.edge_highlight)b.lineWidth=Math.ceil(1.2*b.lineWidth);"vertical"===this.options.direction?(b.beginPath(),b.moveTo(this.loc_1+0.5,c.t),b.lineTo(this.loc_1+0.5,c.b),b.stroke(),b.beginPath(),b.moveTo(this.loc_2+0.5,c.t),b.lineTo(this.loc_2+0.5,c.b),b.stroke()):"horizontal"===this.options.direction&&(b.beginPath(),b.moveTo(c.l,this.loc_1+0.5),b.lineTo(c.r,this.loc_1+0.5),b.stroke(),b.beginPath(),b.moveTo(c.l,this.loc_2+0.5),b.lineTo(c.r,
this.loc_2+0.5),b.stroke())}if(this.options.draw_center_line){b.lineWidth=this.options.center_line_style.lineWidth!==d?this.options.center_line_style.lineWidth:1;b.lineCap=this.options.center_line_style.lineCap!==d?this.options.center_line_style.lineCap:"square";b.strokeStyle=this.options.center_line_style.strokeStyle!==d?this.options.center_line_style.strokeStyle:c.fg;if(this.dragging||this.highlight)b.lineWidth=Math.ceil(1.2*b.lineWidth);"vertical"===this.options.direction?(b.beginPath(),b.moveTo(this.center_location+
0.5,c.t),b.lineTo(this.center_location+0.5,c.b),b.stroke()):"horizontal"===this.options.direction&&(b.beginPath(),b.moveTo(c.l,this.center_location+0.5),b.lineTo(c.r,this.center_location+0.5),b.stroke())}}},set_visible:function(a){this.visible=a;this.plot.redraw()},set_mode:function(a){this.options.mode=a},dispose:function(){this.width=this.center_location=this.center=this.plot=d}}})(window.sigplot=window.sigplot||{},mx,m);
(function(l,g,r,d){l.BoxesPlugin=function(a){this.options=a===d?{}:a;this.options.display===d&&(this.options.display=!0);this.boxes=[]};l.BoxesPlugin.prototype={init:function(a){this.plot=a},menu:function(){var a=function(a){return function(){a.options.display=!a.options.display;a.plot.redraw()}}(this),c=function(a){return function(){a.boxes=[];a.plot.redraw()}}(this);return{text:"Boxes...",menu:{title:"BOXES",items:[{text:"Display",checked:this.options.display,style:"checkbox",handler:a},{text:"Clear All",
handler:c}]}}},add_box:function(a){this.boxes.push(a);this.plot.redraw();return this.boxes.length},clear_boxes:function(){this.boxes=[];this.plot.redraw()},refresh:function(a){if(this.options.display){var c=this.plot._Mx;a=a.getContext("2d");var b,d,h,e,f,n;a.save();a.beginPath();a.rect(c.l,c.t,c.r-c.l,c.b-c.t);a.clip();for(var l=0;l<this.boxes.length;l++){b=this.boxes[l];!0===b.absolute_placement?(d=b.x+c.l,h=b.y+c.t,e=b.w,f=b.h):(f=g.real_to_pixel(c,b.x,b.y),n=g.real_to_pixel(c,b.x+b.w,b.y+b.h),
d=f.x,h=f.y,e=n.x-f.x,f=f.y-n.y);a.strokeStyle=b.strokeStyle||c.fg;a.lineWidth=b.lineWidth||1;1===a.lineWidth%2&&(d+=0.5,h+=0.5);if(b.fillStyle||b.fill)a.globalAlpha=b.alpha||0.5,a.fillStyle=b.fillStyle||a.strokeStyle,a.fillRect(d,h,e,f),a.globalAlpha=1;a.strokeRect(d,h,e,f);b.text&&(a.save(),a.font=b.font||c.text_H+"px Courier New, monospace",a.globalAlpha=1,a.textAlign="end",a.fillStyle=a.strokeStyle,b.font&&(a.font=b.font),d-=c.text_w,h-=c.text_h/3,f=a.measureText(b.text).width,d-f<c.l&&(d+=e),
a.fillText(b.text,d,h),a.restore())}a.restore()}},dispose:function(){this.plot=d;this.boxes=[]}}})(window.sigplot=window.sigplot||{},mx,m);
(function(l,g,r,d){l.PlaybackControlsPlugin=function(a){this.options=a===d?{}:a;this.options.display===d&&(this.options.display=!0);this.options.size=this.options.size||25;this.options.lineWidth=this.options.lineWidth||2;this.state="paused";this.highlight=!1};l.PlaybackControlsPlugin.prototype={init:function(a){this.plot=a;var c=this,b=this.plot._Mx;this.onmousemove=function(a){b.warpbox||(c.ismouseover(a.xpos,a.ypos)?c.set_highlight(!0):c.set_highlight(!1))};this.plot.addListener("mmove",this.onmousemove);
this.onmousedown=function(a){b.warpbox||c.ismouseover(a.xpos,a.ypos)&&a.preventDefault()};this.plot.addListener("mdown",this.onmousedown);this.onmouseclick=function(a){!b.warpbox&&c.ismouseover(a.xpos,a.ypos)&&(c.toggle(),a.preventDefault())};this.plot.addListener("mclick",this.onmouseclick)},set_highlight:function(a){a!==this.highlight&&(this.highlight=a,this.plot.redraw())},toggle:function(a){a||(a="paused"===this.state?"playing":"paused");if(a!==this.state&&this.plot){var c=this.plot._Mx,b=document.createEvent("Event");
b.initEvent("playbackevt",!0,!0);b.state=a;g.dispatchEvent(c,b)&&(this.state=a);this.plot.redraw()}},addListener:function(a,c){g.addEventListener(this.plot._Mx,a,c,!1)},removeListener:function(a,c){g.removeEventListener(this.plot._Mx,a,c,!1)},ismouseover:function(a,c){var b=this.position();return Math.pow(a-b.x,2)+Math.pow(c-b.y,2)<Math.pow(this.options.size/2,2)},position:function(){if(this.options.position)return this.options.position;if(this.plot){var a=this.plot._Mx,c=this.options.size/2;return{x:a.l+
c+this.options.lineWidth+1,y:a.t+c+this.options.lineWidth+1}}return{x:null,y:null}},refresh:function(a){var c,b,d;if(this.options.display){var h=this.plot._Mx,e=a.getContext("2d");e.lineWidth=this.options.lineWidth;var f=this.options.size/2;this.highlight&&(e.lineWidth+=2,f+=1);var g=this.position();e.beginPath();e.arc(g.x,g.y,f-e.lineWidth,0,2*Math.PI,!0);e.closePath();e.strokeStyle=this.options.strokeStyle||h.fg;e.stroke();this.options.fillStyle&&(e.fillStyle=this.options.fillStyle,e.fill());if("paused"===
this.state){var l;b=0.8*f+(g.x-f);a=1.45*f+(g.x-f);l=0.8*f+(g.x-f);d=0.56*f+(g.y-f);c=f+(g.y-f);f=1.45*f+(g.y-f);e.beginPath();e.moveTo(b,d);e.lineTo(a,c);e.lineTo(l,f);e.closePath();e.fillStyle=this.options.strokeStyle||h.fg;e.fill()}else e.lineCap="round",e.lineWidth=Math.floor(Math.min(1,this.options.size/8)),b=0.8*f+(g.x-f),a=0.8*f+(g.x-f),d=f/2+(g.y-f),c=1.5*f+(g.y-f),e.beginPath(),e.moveTo(b,d),e.lineTo(a,c),e.closePath(),e.stroke(),b=f+f/5+(g.x-f),a=f+f/5+(g.x-f),d=f/2+(g.y-f),c=1.5*f+(g.y-
f),e.beginPath(),e.moveTo(b,d),e.lineTo(a,c),e.closePath(),e.stroke();e.restore()}},dispose:function(){this.boxes=this.plot=d}}})(window.sigplot=window.sigplot||{},mx,m);

angular.module('redhawk.directives').run(['$templateCache', function($templateCache) {
  'use strict';

  $templateCache.put('directives/tmpls/events/event-view.html',
    "<div ng-repeat=\"rhEvent in rhEvents | orderBy: '-' | limitTo: max\" \n" +
    "     ng-switch=\"typeOfEvent(rhEvent)\">\n" +
    "    <odm-event     ng-switch-when=\"1\" rh-event=\"rhEvent\"></odm-event>\n" +
    "    <idm-event     ng-switch-when=\"2\" rh-event=\"rhEvent\"></idm-event>\n" +
    "    <prop-event    ng-switch-when=\"3\" rh-event=\"rhEvent\"></prop-event>\n" +
    "    <message-event ng-switch-when=\"4\" rh-event=\"rhEvent\"></message-event>\n" +
    "</div>"
  );


  $templateCache.put('directives/tmpls/events/idm-event.html',
    "<div>\n" +
    "<h4>IDM Event</h4>\n" +
    "<dl class=\"dl-horizontal\">\n" +
    "    <dt>Source ID</dt>\n" +
    "    <dd>{{ obj.sourceId }}</dd>\n" +
    "\n" +
    "    <dt>Producer ID</dt>\n" +
    "    <dd>{{ obj.producerId }}</dd>\n" +
    "\n" +
    "    <dt>State Change Category</dt>\n" +
    "    <dd>{{ obj.stateChangeCategory.value }}</dd>\n" +
    "\n" +
    "    <dt>From</dt>\n" +
    "    <dd>{{ obj.stateChangeFrom.value }}</dd>\n" +
    "    \n" +
    "    <dt>To</dt>\n" +
    "    <dd>{{ obj.stateChangeTo.value   }}</dd>\n" +
    "</dl>\n" +
    "</div>"
  );


  $templateCache.put('directives/tmpls/events/message-event.html',
    "<div>\n" +
    "<h4>Message</h4>\n" +
    "<dl class=\"dl-horizontal\">\n" +
    "    <dt>Property ID</dt><dd>{{ obj.id | cleanPropId }}</dd>\n" +
    "    <dt>JSON Value</dt><dd>{{ obj.value }}</dd>\n" +
    "</dl>\n" +
    "</div>"
  );


  $templateCache.put('directives/tmpls/events/odm-event.html',
    "<div>\n" +
    "<h4>ODM Event</h4>\n" +
    "<dl class=\"dl-horizontal\">\n" +
    "    <dt>{{ (obj.hasOwnProperty('sourceIOR') ? 'Added' : 'Removed') }}</dt>\n" +
    "    <dd>&nbsp</dd>\n" +
    "\n" +
    "    <dt>Source ID</dt>\n" +
    "    <dd>{{ obj.sourceId }}</dd>\n" +
    "    \n" +
    "    <dt>Producer ID</dt>\n" +
    "    <dd>{{ obj.producerId }}</dd>\n" +
    "\n" +
    "    <dt>Source Name</dt>\n" +
    "    <dd>{{ obj.sourceName }}</dd>\n" +
    "\n" +
    "    <dt>Source Category</dt>\n" +
    "    <dd>{{ obj.sourceCategory.value }}</dd>\n" +
    "</dl>\n" +
    "</div>"
  );


  $templateCache.put('directives/tmpls/events/prop-event.html',
    "<div>\n" +
    "<h4>Property Event</h4>\n" +
    "<dl class=\"dl-horizontal\">    \n" +
    "    <dt>Source ID</dt>\n" +
    "    <dd>{{ obj.sourceId }}</dd>\n" +
    "\n" +
    "    <dt>Source Name</dt>\n" +
    "    <dd>{{ obj.sourceName }}</dd>\n" +
    "\n" +
    "    <dt>Property IDs</dt>\n" +
    "    <dd><span ng-repeat=\"prop in obj.properties\">{{ prop.id }}<br></span></dd>\n" +
    "</dl>\n" +
    "</div>"
  );

}]);
