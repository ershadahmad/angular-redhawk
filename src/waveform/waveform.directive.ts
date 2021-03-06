import {
    Directive,
    OnDestroy,
    OnChanges,
    SimpleChanges,
    Input,
    Output,
    EventEmitter
} from '@angular/core';
import { Subscription } from 'rxjs/Subscription';

import { Waveform }          from '../models/index';

import { WaveformService }         from './waveform.service';
import { waveformServiceProvider } from './waveform-service-provider';

/**
 * The Waveform directive provides the dependency injection start point for
 * a running Waveform (Application) in the Domain
 * 
 * @example
 * <div [arWaveform]="'DCE:...'" [(arModel)]="my_model">
 */
@Directive({
    selector: '[arWaveform]',
    exportAs: 'arWaveform',
    providers: [ waveformServiceProvider() ]
})
export class WaveformDirective implements OnDestroy, OnChanges {

    /**
     * Sets the ID for the underlying service
     */
    @Input('arWaveform') waveformId: string;

    /** Setter for "Banana in a Box Syntax"  */
    @Input('arModel') model: Waveform;
    /** Emitter for "Banana in a Box Syntax"  */
    @Output('arModelChange') modelChange: EventEmitter<Waveform>;

    /** Internal subscription for the model */
    private subscription: Subscription = null;

    /**
     * Constructor
     * @param service The service either imported from up the hierarchy or instantiated
     *                by this directive.
     */
    constructor(public service: WaveformService) {
        this.modelChange = new EventEmitter<Waveform>();
        this.subscription = this.service.model$.subscribe(it => {
            this.model = it;
            this.modelChange.emit(this.model);
        });
    }

    /**
     * Implementation of the OnChanges interface updates the service's uniqueID
     * @param changes The changes made to this component
     */
    ngOnChanges(changes: SimpleChanges) {
        if (changes.hasOwnProperty('waveformId') && this.waveformId) {
            this.service.uniqueId = this.waveformId;
        }
    }

    /**
     * Implementation of the OnDestroy interface unsubscribes from the model observable.
     */
    ngOnDestroy() {
        this.subscription.unsubscribe();
    }
}
