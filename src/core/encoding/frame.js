import { baseEncoding } from './baseEncoding';
import { action, observable, reaction, trace } from 'mobx'
import { FULFILLED } from 'mobx-utils'
import { assign, applyDefaults, relativeComplement, configValue, parseConfigValue, inclusiveRange, combineStates, equals } from '../utils';
import { DataFrameGroupMap } from '../../dataframe/dataFrameGroup';
import { createMarkerKey, parseMarkerKey } from '../../dataframe/dfutils';
import { configSolver } from '../dataConfig/configSolver';
import { DataFrame } from '../../dataframe/dataFrame';
import { resolveRef } from '../config';

const defaultConfig = {
    modelType: "frame",
    value: null,
    loop: false,
    data: {
        concept: {
            selectMethod: "selectFrameConcept"
        }
    },
    scale: {
        clampToData: true
    }
}

const defaults = {
    interpolate: true,
    loop: false,
    playbackSteps: 1,
    speed: 100,
    splash: false
}

const functions = {
    get value() {
        let value;

        if (this.config.value != null) {
            value = this.parseValue(this.config.value);
            value = this.scale.clampToDomain(value) //, this.data.domain);
        } else {
            value = this.scale.domain[0];
        }
        return value;
    },
    parseValue(value){
        return parseConfigValue(value, this.data.conceptProps);
    },
    formatValue(value){
        return configValue(value, this.data.conceptProps);
    },
    get step() { return this.stepScale(this.value); },
    
    /**
     * Scale with frame values (e.g. years) as domain and step number (e.g. 0-15) as range.
     * Can't use 2 point linear scale as time is not completely linear (leap year/second etc)
     * @returns D3 scale
     */
    get stepScale() {
        const range = d3.range(0, this.stepCount);
        const scale = this.scale.d3Type(this.domainValues, range); 

        // fake clamped invert for ordinal scale
        // https://github.com/d3/d3/issues/3022#issuecomment-260254895
        if (!scale.invert) scale.invert = step => this.domainValues[step];

        return scale;
    },
    /**
     * Key frame values limited to scale domain
     **/ 
    get domainValues() {
        let frameValues = [];
        // default domain data is after filtering, so empty frames are dropped, so steps doesn't include those
        for (let [key, group] of this.data.domainData) {
            const frameValue = group.values().next().value[this.name];
            if (this.scale.domainIncludes(frameValue)) {
                frameValues.push(frameValue);
            } 
        }
        return frameValues
    },
    get stepCount() {
        return this.domainValues.length;
    },

    // PLAYBACK
    get speed() { return this.config.speed || defaults.speed },
    get loop() { return this.config.loop || defaults.loop },
    get playbackSteps() { return this.config.playbackSteps || defaults.playbackSteps },
    playing: false,
    togglePlaying() {
        this.playing ?
            this.stopPlaying() :
            this.startPlaying();
    },
    startPlaying: action('startPlaying', function startPlaying() {
        if (this.step >= this.stepCount - 1)
            this.setStep(0);

        this.setPlaying(true);
    }),
    stopPlaying: function() {
        this.setPlaying(false);
    },
    setPlaying: action('setPlaying', function setPlaying(playing) {
        this.playing = playing;
    }),
    setSpeed: action('setSpeed', function setSpeed(speed) {
        speed = Math.max(0, speed);
        this.config.speed = speed;
    }),
    setValue: action('setValue', function setValue(value) {
        let concept = this.data.conceptProps;
        let parsed = this.parseValue(value);
        if (parsed != null) {
            parsed = this.scale.clampToDomain(parsed);
        }
        this.config.value = configValue(parsed, concept);
    }),
    setStep: action('setStep', function setStep(step) {
        this.setValue(this.stepScale.invert(step));
    }),
    setValueAndStop: action('setValueAndStop', function setValueAndStop(value) {
        this.stopPlaying();
        this.setValue(value);
    }),
    setStepAndStop: action('setStepAndStop', function setStepAndStop(step) {
        this.stopPlaying();
        this.setStep(step);
    }),
    snap: action('snap', function snap() {
        this.setStep(Math.round(this.step));
    }),
    ceilKeyFrame() {
        return this.stepScale.invert(Math.ceil(this.step));
    },
    nextStep: action('update to next frame value', function nextStep() {
        if (this.playing && this.marker.state === FULFILLED) {
            let nxt = this.step + this.playbackSteps;
            if (nxt < this.stepCount) {
                this.setStep(nxt);
            } else if (this.step == this.stepCount - 1) {
                // on last frame
                if (this.loop) {
                    this.setStep(0);          
                } else {
                    this.stopPlaying();
                }
            } else {
                // not yet on last frame, go there first
                this.setStep(this.stepCount - 1); 
            }
        }
    }),

    /**
     * Given an array of normalized marker-key strings, gives the extent/domain of each in the frameMap
     * @param {[string]} markerKeys
     * @returns 
     */
    markerLimits(markerKeys) {
        const frameMap = this.dataMapBeforeTransform("currentFrame");
        return frameMap.extentOfGroupMapKeyPerMarker(markerKeys)
    },

    // TRANSFORMS
    get transformationFns() {
        return {
            'frameMap': this.frameMap.bind(this),
            'currentFrame': this.currentFrame.bind(this)
        }
    },

    // FRAMEMAP TRANSFORM
    get interpolate() { return this.config.interpolate || defaults.interpolate },
    frameMap(data) {
        if (data.size > 0 && this.interpolate) 
            data = this.interpolateData(data);
        return data.groupBy(this.name, this.rowKeyDims);
    },
    interpolateData(df) {
        const concept = this.data.concept;
        const name = this.name;
        // can't use scale.domain as it is calculated after 
        // filterRequired, which needs data to be interpolated (and might have less frames)
        const domain = this.data.calcDomain(df, this.data.conceptProps);
        const newIndex = inclusiveRange(domain[0], domain[1], concept);

        return df
            .groupBy(this.rowKeyDims, [name])
            .map((group, groupKeyDims) => { 

                const fillFns = {};
                df.key.forEach(dim => {
                    // copy space values from group key
                    if (dim in groupKeyDims) 
                        fillFns[dim] = groupKeyDims[dim];
                    // frame concept not in group key so copy from row
                    if (dim === concept)
                        fillFns[dim] = row => row[name];  
                })

                return group
                    .reindex(newIndex) // reindex also orders (needed for interpolation)
                    .fillNull(fillFns) // fill nulls of marker space with custom fns
                    .interpolate();    // fill rest of nulls through interpolation
            })
            .flatten(df.key);
    },
    get rowKeyDims() {
        // remove frame concept from key if it's in there
        // e.g. <geo,year>,pop => frame over year => <year>-><geo>,year,pop 
        return relativeComplement([this.data.concept], this.data.space);
    },

    // CURRENTFRAME TRANSFORM
    currentFrame(data) {
        if (data.size == 0) 
            return DataFrame([], data.descendantKeys[0]);

        return data.has(this.frameKey) ? 
            data.get(this.frameKey)
            :
            this.getInterpolatedFrame(data, this.step, this.stepsAround);

    },
    get frameKey() {
        return createMarkerKey({ [this.name]: this.value });
    },
    getInterpolatedFrame(df, step, stepsAround) {
        const keys = Array.from(df.keys());
        const [before, after] = stepsAround.map(step => df.get(keys[step]));
        return before.interpolateTowards(after, step % 1);
    },
    get stepsAround() {
        return [Math.floor(this.step), Math.ceil(this.step)];
    },
    get framesAround() {
        return this.stepsAround.map(this.stepScale.invert);
    },

    /*
     * Compute the differential (stepwise differences) for the given field 
     * and return it as a new dataframe(group).
     * NOTE: this requires that the given df is interpolated.
     * USAGE: set a correct list of transformations on the __marker__
     * and then add/remove the string "differentiate" to the data of an 
     * encoding in that marker. For example:
     *   markers: {
     *      marker_destination: {
     *        encoding: {
     *           "x": {
     *             data: {
     *               concept: "displaced_population",
     *               transformations: ["differentiate"]
     *             }
     *           },
     *          ...
     *        },
     *        transformations: [
     *          "frame.frameMap",
     *          "x.differentiate",
     *          "filterRequired",
     *          "order.order",
     *          "trail.addTrails",
     *          "frame.currentFrame"
     *        ]
     * 
     */
    differentiate(df, xField) {
        let prevFrame;
        let result = DataFrameGroupMap([], df.key, df.descendantKeys);
        for (let [yKey, frame] of df) {
            const newFrame = frame.copy()
            for(let [key, row] of newFrame) {
                const newRow = Object.assign({}, row);
                const xValue = row[xField];
                if (xValue !== undefined) {
                    newRow[xField] = prevFrame ? xValue - prevFrame.get(parseMarkerKey(key))[xField] : 0;
                }
                newFrame.set(newRow, key);
            }
            prevFrame = frame;
            result.set(yKey, newFrame);
        }
        return result;
    },
    get state() {
        const states = [this.data.state, this.data.source.conceptsPromise.state];
        return combineStates(states);
    },
    onCreate() {
        // need reaction for timer as it has to set frame value
        // not allowed to call action (which changes state) from inside observable/computed, thus reaction needed
        const playbackDestruct = reaction(
            // mention all observables (state & computed) which you want to be tracked
            // if not tracked, they will always be recomputed, their values are not cached
            () => { return { playing: this.playing, speed: this.speed } },
            ({ playing, speed }) => {
                clearInterval(this.playInterval);
                if (playing) {
                    this.nextStep();
                    this.playInterval = setInterval(this.nextStep.bind(this), speed);
                }
            }, 
            { name: "frame playback timer" }
        );
        this.destructers.push(playbackDestruct);
        const configLoopbackDestruct = reaction(
            () => { 
                const waitFor = this.marker || this;
                if (waitFor.state == 'fulfilled') return this.value 
            },
            (value) => {
                if (value && "value" in this.config && !equals(this.config.value, value)) {
                    this.config.value = configValue(value, this.data.conceptProps);
                }
            },
            { name: "frame config loopback" }
        );
        this.destructers.push(configLoopbackDestruct);
        this.destructers.push(() => {
            clearInterval(this.playInterval);
        })
    },
    get splash() { 
        return this.config.splash || defaults.splash;
    }
}

export function frame(...args) {
    const obs = observable(frame.nonObservable(...args));
    obs.onCreate();
    return obs;
}

frame.nonObservable = function(config, parent) {
    applyDefaults(config, defaultConfig);
    
    return assign(baseEncoding.nonObservable(config, parent), functions);
}

frame.splashMarker = function splashMarker(marker) {
    const frame = marker.encoding.frame;
    if (frame?.splash) {
        const concept = resolveRef(frame.config.data.concept);
        if (typeof concept == "string") {
            let splashConfig = Vizabi.utils.deepclone(marker.config);
            const filterMerge = { data: { filter: { dimensions: { [concept]: { [concept]: 
                frame.config.value 
            } } } } }
            splashConfig = Vizabi.utils.deepmerge(splashConfig, filterMerge);
            
            let splashMarker = Vizabi.marker(splashConfig, marker.id + '-splash');
            let proxiedMarker = markerWithFallback(marker, splashMarker);

            return { marker: proxiedMarker, splashMarker }
        } else {
            console.warn("Frame splash does not work with autoconfig concept. Please set frame.data.concept or disable splash.")
            return { marker };
        }
    } else {
        return { marker };
    }
}

function markerWithFallback(marker, fallback) {
    let firstLoad = true;
    return new Proxy(marker, {
        get: function(target, prop, receiver) {
            
            if (marker.state == 'fulfilled') {
                if (firstLoad) {
                    firstLoad = false;
                    fallback.dispose();
                    fallback = undefined;
                }
                return target[prop];
            } 
            else if (firstLoad && fallback.state == 'fulfilled')  {
                return fallback[prop];
            } 
            else {
                return target[prop];
            }

        }
    })
}

configSolver.addSolveMethod(
    function selectFrameConcept({ concepts, space, dataConfig }) {
        const spaceConcepts = space.map(dim => dataConfig.source.getConcept(dim));
        return findTimeOrMeasure(spaceConcepts) || findTimeOrMeasure(concepts) || spaceConcepts[spaceConcepts.length - 1];
        
        function findTimeOrMeasure (concepts) {
            return concepts.find(c => c.concept_type == 'time') || concepts.find(c => c.concept_type == 'measure');
        }
    }
)