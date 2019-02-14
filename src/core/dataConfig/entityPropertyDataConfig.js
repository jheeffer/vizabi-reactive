import { dataConfig } from './dataConfig';
import { compose, renameProperty } from '../utils';
import { observable, trace, toJS } from 'mobx';
import { fromPromise } from 'mobx-utils';
import { DataFrame } from '../../dataframe/dataFrame';

export function entityPropertyDataConfig(cfg, parent) {
    const base = dataConfig(cfg, parent);

    return compose(base, {

        get promise() {
            return fromPromise(this.source.conceptsPromise.then(() => {
                const entityDims = this.space.filter(dim => this.source.isEntityConcept(dim));
                const labelPromises = entityDims.map(dim =>
                    this.source.query({
                        select: {
                            key: [dim],
                            value: [this.concept]
                        },
                        from: "entities"
                    }).then(data => ({
                        dim,
                        data
                    }))
                );
                return fromPromise(Promise.all(labelPromises));
            }))
        },
        get lookups() {
            const concept = this.concept;
            const lookups = new Map();
            this.response.forEach(response => {
                const { dim, data } = response;
                const lookup = new Map();
                lookups.set(dim, lookup);
                data.forEach(row => {
                    lookup.set(row[dim], row[concept]);
                })
            });
            return new Map([[this.concept, lookups]]);
        },
        get responseMap() {
            return DataFrame.fromLookups(this.lookups, this.commonSpace)
        },
        addLabels(markers, encName) {
            // reduce lookups
            const space = toJS(this.space);
            const lookups = this.lookups;
            markers.forEach((marker, key) => {
                const label = {};
                space.forEach(dim => {
                    if (lookups.has(dim))
                        label[dim] = lookups.get(dim).get(marker[dim]);
                    else
                        label[dim] = marker[dim];
                });
                marker[encName] = label;
            });
        }
    })
}