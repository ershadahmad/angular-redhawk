import { ISerializable } from '../../serialization/index';

import { OdmEvent } from './odm-event';
import { ResourceStateChange } from './enums/index';

/**
 * Serializable REDHAWK ODM Resource State Change Event
 */
export class ResourceStateChangeEvent
    extends OdmEvent
    implements ISerializable<ResourceStateChangeEvent> {

    public stateChangeFrom: ResourceStateChange;
    public stateChangeTo:   ResourceStateChange;

    deserialize(input: any) {
        super.deserialize(input);
        this.stateChangeFrom = fromString(input.stateChangeFrom.value);
        this.stateChangeTo = fromString(input.stateChangeTo.value);
        return this;
    }
}

function fromString(state: string): ResourceStateChange {
    let out = ResourceStateChange.UNKNOWN;
    switch (state) {
        case 'STOPPED':
            out = ResourceStateChange.STOPPED;
            break;
        case 'STARTED':
            out = ResourceStateChange.STARTED;
            break;
        default:
            // Do anything?
            break;
    }
    return out;
}