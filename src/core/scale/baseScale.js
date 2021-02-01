import { applyDefaults, parseConfigValue } from "../utils";
import { trace } from "mobx";

const scales = {
    "linear": d3.scaleLinear,
    "log": d3.scaleLog,
    "genericLog": d3.scaleSymlog,
    "sqrt": d3.scaleSqrt,
    "ordinal": d3.scaleOrdinal,
    "point": d3.scalePoint,
    "band": d3.scaleBand,
    "time": d3.scaleUtc
}


const defaultConfig = {
    domain: null,
    range: null,
    type: null,
    zoomed: null,
    fixBaseline: null,
    clamp: false
}

const defaults = {
    domain: [0,1]
}

export function baseScale(config = {}, parent) {

    applyDefaults(config, defaultConfig);
  
    function isArrayOneSided(array){
        if (!array) return false;
        if (array.length < 2) return true;
        return !(d3.min(array) <= 0 && d3.max(array) >= 0);
    }

    return {
        config,
        parent,
        // ordinal, point or band
        ordinalScale: "ordinal",
        get data() {
            return this.parent.data;
        },
        get type() {
            if (this.data.isConstant()) {
                return this.ordinalScale;
            }
            const concept = this.data.conceptProps;
            let scaleType = null;
            let scale;
            if (scales[this.config.type])
                scaleType = this.config.type;
            else if (concept && concept.scales && (scale = JSON.parse(concept.scales)[0]) && scales[scale])
                scaleType = scale;
            else if (concept && ["entity_domain", "entity_set", "string"].includes(concept.concept_type))
                scaleType = this.ordinalScale;
            else if (concept && ["time"].includes(concept.concept_type))
                scaleType = "time";
            else
                scaleType = "linear";
            
            if (scaleType == "log" && !isArrayOneSided(this.domain)) {
                scaleType = "genericLog";
            }

            return scaleType;
        },
        get range() {
            if (this.config.range != null)
                return this.config.range

            // default for constant is identity
            if (this.data.isConstant())
                return this.domain;

            // default
            return (this.type == "ordinal") ?
                d3.schemeCategory10 : [0, 1];
        },
        set range(range) {
            this.config.range = range;
        },
        get domain() {
            trace();
            if (this.config.domain) {
                return this.config.domain.map(c => parseConfigValue(c, this.data.conceptProps));
            } else if (this.data.domain) {   
                //fixBaseline can override the domain if defined and if data domain is one-sided
                //by replaceing the value closest to zero with the one provided in config
                //use cases: forcing zero-based bar charts and bubble size
                if (this.config.fixBaseline != null && isArrayOneSided(this.data.domain)){
                  let closestToZero = d3.scan(this.data.domain.map(d => Math.abs(d)));
                  return this.data.domain.map((d,i)=>(i == closestToZero ? this.config.fixBaseline : d));
                } else {
                  return this.data.domain;
                }
            } else {
                return defaults.domain;
            }      
        },
        set domain(domain) {
            this.config.domain = domain;
        },
        clampToDomain(val) {
            const domain = this.domain;
            if (this.isDiscrete())
                return domain.includes(val) ? val : undefined;
            
            if (val < domain[0]) return domain[0];
            if (val > domain[1]) return domain[1];
            return val;
        },
        d3ScaleCreate() {
            const scale = scales[this.type]();
            if (this.type === "genericLog") {
                //TODO
                //scale.constant(limitsObj.minAbsNear0);
            }
            if(scale.clamp) scale.clamp(this.config.clamp);
            return scale.domain(this.domain).range(this.range);
        },
        get d3Scale() {
            return this.d3ScaleCreate();
        },
        get zoomed() {
            return this.config.zoomed ? this.config.zoomed.map(c => parseConfigValue(c, this.data.conceptProps)) : this.domain;
        },
        set zoomed(zoomed) {
            this.config.zoomed = zoomed;
        },
        isDiscrete() {
            return this.type == "ordinal" || this.type == "band" || this.type == "point";
        }
    }
}