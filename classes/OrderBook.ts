import { OrderedMap, Queue } from "js-sdsl";
import type { CURRENCY_SYMBOL, ORDER_ID, SIDE, TYPE } from "../types/order.js";

type ORDER = {
  userId: string;
  price: number;
  qty: number;
  filledQty: number;
  orderId: string;
  createdAt: Date;
};

type PRICE_LEVEL = { TotalQuantity: number; orders: Queue<ORDER> };

type FILLS_INFO = {
  buyerId: string;
  sellerId: string;
  symbol: CURRENCY_SYMBOL;
  qty: number;
  price: number;
  bidPrice: number;
}[];

type ORDERBOOK = Partial<
  Record<
    CURRENCY_SYMBOL,
    {
      BIDS: OrderedMap<number, PRICE_LEVEL>;
      ASKS: OrderedMap<number, PRICE_LEVEL>;
    }
  >
>;

export default class OrderBook {
  orderBook: ORDERBOOK = {};
  orders: Record<ORDER_ID, ORDER> = {}; // here keep ref of item in orderbook, to not double memeory

  createOrder = (
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    price: number,
    qty: number,
    userId: string,
  ): {
    newOrderId: ORDER_ID;
    totalFilledQuantity: number;
    fillsInfo: FILLS_INFO;
  } => {
    if (!this.orderBook[symbol]) {
      this.orderBook[symbol] = {
        ASKS: new OrderedMap(),
        BIDS: new OrderedMap(),
      };
    }

    let currentOrder: ORDER = {
      createdAt: new Date(),
      filledQty: 0,
      orderId: crypto.randomUUID(),
      price: price,
      qty: qty,
      userId: userId,
    };

    if (side == "BUY") {
      if (!this.orderBook[symbol].BIDS?.getElementByKey(price)) {
        this.orderBook[symbol].BIDS.setElement(price, {
          TotalQuantity: 0,
          orders: new Queue(),
        });
      }
    } else {
      if (!this.orderBook[symbol].ASKS?.getElementByKey(price)) {
        this.orderBook[symbol].ASKS.setElement(price, {
          TotalQuantity: 0,
          orders: new Queue(),
        });
      }
    }

    let fillsToReturn: FILLS_INFO = [];

    let oppositeSideOrders;
    if (side == "BUY") oppositeSideOrders = this.orderBook[symbol].ASKS;
    else oppositeSideOrders = this.orderBook[symbol].BIDS;

    const shouldExchange = (
      topOppositeSidePrice: number,
      price: number,
      side: SIDE,
    ): boolean => {
      if (side == "BUY") {
        return topOppositeSidePrice <= price;
      } else {
        return topOppositeSidePrice >= price;
      }
    };

    // try matching as much possible
    while (
      !oppositeSideOrders.empty() &&
      currentOrder.filledQty < currentOrder.qty
    ) {
      let [topOppositeSidePrice, topOppositeSidePriceLevel] =
        oppositeSideOrders.front()!;

      let orders = topOppositeSidePriceLevel.orders;

      if (
        (type == "LIMIT" &&
          shouldExchange(topOppositeSidePrice, price, side)) ||
        type == "MARKET"
      ) {
        while (currentOrder.filledQty < currentOrder.qty && !orders.empty()) {
          let frontOrder = orders.front();
          let pendingQty = frontOrder!.qty - frontOrder!.filledQty;

          let toExchangeQty = Math.min(
            currentOrder.qty - currentOrder.filledQty,
            pendingQty,
          );

          fillsToReturn.push({
            bidPrice: Math.max(frontOrder!.price, currentOrder.price),
            buyerId: userId,
            sellerId: frontOrder!.userId,
            price: Math.min(frontOrder!.price, currentOrder.price),
            qty: toExchangeQty,
            symbol,
          });

          frontOrder!.filledQty += toExchangeQty;
          currentOrder.filledQty += toExchangeQty;
          topOppositeSidePriceLevel.TotalQuantity -= toExchangeQty;

          if (frontOrder!.filledQty == frontOrder!.qty) {
            // remove from orders and orderbook
            delete this.orders[frontOrder!.orderId];
            orders.pop();
          }
        }
        if (orders.empty()) {
          oppositeSideOrders.eraseElementByKey(topOppositeSidePrice);
        }
      } else break;
    }

    // for limit order
    // sit on orderbook for pending order
    if (type == "LIMIT" && currentOrder.filledQty < currentOrder.qty) {
      // put into orders object
      this.orders[currentOrder.orderId] = currentOrder;

      let prevPriceLevel: PRICE_LEVEL;

      if (side == "BUY")
        prevPriceLevel = this.orderBook[symbol].BIDS.getElementByKey(price) || {
          TotalQuantity: 0,
          orders: new Queue(),
        };
      else
        prevPriceLevel = prevPriceLevel = this.orderBook[
          symbol
        ].ASKS.getElementByKey(price) || {
          TotalQuantity: 0,
          orders: new Queue(),
        };

      prevPriceLevel.TotalQuantity += currentOrder.qty - currentOrder.filledQty;
      prevPriceLevel.orders.push(currentOrder);

      // put into orderbook object
      if (side == "BUY")
        this.orderBook[symbol].BIDS.setElement(price, prevPriceLevel);
      else this.orderBook[symbol].ASKS.setElement(price, prevPriceLevel);
    }

    return {
      fillsInfo: fillsToReturn,
      newOrderId: currentOrder.orderId,
      totalFilledQuantity: currentOrder.filledQty,
    };
  };

  cancelOrder = (
    orderId: ORDER_ID,
  ): {
    filledQuantity: number;
    totalQuantity: number;
    price: number;
    side: SIDE;
    userId: string;
    symbol: CURRENCY_SYMBOL;
  } => {
    //
    if (!this.orders[orderId]) {
    }
  };

  getOrder = (orderId: ORDER_ID) => {};
  getDepth = (symbol: CURRENCY_SYMBOL) => {};
}
