import { DataFrame } from "../dataFrame";

const directions = {
    ascending: 1,
    decending: -1
}

export function order(df, order_by = []) {
    if (order_by.length == 0) return df;

    const data = Array.from(df);
    const orderNormalized = normalizeOrder(order_by);
    const n = orderNormalized.length;

    data.sort((a,b) => {
        for (var i = 0; i < n; i++) {
            const order = orderNormalized[i];
            if (a[1][order.concept] < b[1][order.concept])
                return -1 * order.direction;
            else if (a[1][order.concept] > b[1][order.concept])
                return order.direction;
        } 
        return 0;
    });

    return DataFrame(new Map(data), df.key);
}

/**    
 * Process ["geo"] or [{"geo": "asc"}] to [{ concept: "geo", direction: 1 }];
 * @param {} order 
 */
function normalizeOrder(order_by) {
    return order_by.map(orderPart => {
        if (typeof orderPart == "string") {
            return { concept: orderPart, direction: directions.ascending };
        }	else {
            const concept   = Object.keys(orderPart)[0];
            const direction = orderPart[concept] == "asc" 
                ? directions.ascending 
                : directions.decending;
            return { concept, direction };
        }
    });
}