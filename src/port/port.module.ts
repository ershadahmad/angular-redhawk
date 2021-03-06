import { NgModule } from '@angular/core';
import { HttpModule } from '@angular/http';

import { RestPythonModule } from '../rest-python/rest-python.module';
import { SocketsModule }    from '../sockets/sockets.module';
import { DeviceModule }     from '../device/device.module';
import { ComponentModule }  from '../component/component.module';
import { WaveformModule }   from '../waveform/waveform.module';

import { PortDirective }       from './port.directive';
import { PortsPipe }           from './ports.pipe';
export { PortDirective }       from './port.directive';
export { PortsPipe }           from './ports.pipe';
export *                       from './refs/index';
export { PortService }         from './port.service';
export { portServiceProvider } from './port-service-provider';

/**
 * The PortModule provides directives and sub-interfaces (refs) for managing a
 * Port instance on a Component, Waveform, or Device.
 */
@NgModule({
    imports:      [
        HttpModule,
        RestPythonModule,
        DeviceModule,
        ComponentModule,
        WaveformModule,
        SocketsModule
    ],
    exports:      [ PortDirective, PortsPipe ],
    declarations: [ PortDirective, PortsPipe ]
})
export class PortModule {}
