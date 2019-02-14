import { applyDefaults, assign } from "../utils";
import { base } from "./base";

const defaultConfig = {
    type: "sqrt",
    range: [0, 20]
}

export function size(config, parent) {

    applyDefaults(config, defaultConfig);
    const s = base(config, parent);

    return assign(s, {
        ordinalScale: "point",
        get range() {
            if (this.config.range != null)
                return this.config.range
            if (this.type == "point")
                return [1, 20];
            return [0, 20];
        }
    });
}