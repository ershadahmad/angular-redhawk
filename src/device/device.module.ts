import { NgModule } from '@angular/core';
import { HttpModule } from '@angular/http';

import { RestPythonModule } from '../rest-python/rest-python.module';
import { DeviceManagerModule } from '../devicemanager/devicemanager.module';
import { PortModule } from '../port/port.module';

import { DeviceDirective } from './device.directive';

export { DeviceService }   from './device.service';
export { DeviceDirective } from './device.directive';

// Interfaces
export * from './device-property-command';
export * from './device-property-command-response';
export * from './device-property-command-type';

@NgModule({
    imports: [
        HttpModule,
        DeviceManagerModule,
        RestPythonModule.forChild(),
        PortModule
        ],
    exports:      [ DeviceDirective ],
    declarations: [ DeviceDirective ]
})
export class DeviceModule {}
