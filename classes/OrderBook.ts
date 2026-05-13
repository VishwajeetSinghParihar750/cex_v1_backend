import { OrderedMap, LinkList } from "js-sdsl";
import type { CURRENCY_SYMBOL, ORDER_ID, SIDE, TYPE } from "../types/order.js";
import { assert } from "node:console";

type ORDER = {
  userId: string;
  price: number;
  qty: number;
  side: SIDE;
  symbol: CURRENCY_SYMBOL;
  type: TYPE;
  filledQty: number;
  orderId: string;
  createdAt: Date;
};

type PRICE_LEVEL = { totalQuantity: number; orders: LinkList<ORDER> };

type FILL_INFO = {
  fillId: string;
  buyerId: string;
  sellerId: string;
  symbol: CURRENCY_SYMBOL;
  qty: number;
  price: number;
  bidPrice: number;
};

export type FILLS_INFO = FILL_INFO[];
type DEPTH = { price: number; quantity: number }[];

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
  fills: Record<string, FILL_INFO> = {};

  private placeMarketBuyOrder = (
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    qty: number,
    userId: string,
    maxMarketBidSpend: number, // TODO
  ) => {
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
      price: 0, // 0 price means  market order
      qty: qty,
      userId: userId,
      side,
      type,
      symbol,
    };

    let fillsToReturn: FILLS_INFO = [];

    let oppositeSideOrders = this.orderBook[symbol].ASKS;

    // try matching as much possible
    while (
      !oppositeSideOrders.empty() &&
      currentOrder.filledQty < currentOrder.qty &&
      maxMarketBidSpend > 0
    ) {
      let [topOppositeSidePrice, topOppositeSidePriceLevel] =
        oppositeSideOrders.front()!;

      let orders = topOppositeSidePriceLevel.orders;

      assert(!orders.empty()); // if oders is empty then it should not be in oppositeSideOrders

      while (currentOrder.filledQty < currentOrder.qty) {
        let frontOrder = orders.front();
        let pendingQty = frontOrder!.qty - frontOrder!.filledQty;

        let maxExchangeQty = Math.min(
          currentOrder.qty - currentOrder.filledQty,
          pendingQty,
        );

        // TODO : HANDLE FLOATING POINT ERRORS HERE COZ OF DIVIDING
        let toExchangeQty = Math.min(
          maxExchangeQty,
          maxMarketBidSpend / frontOrder!.price,
        );

        fillsToReturn.push({
          fillId: crypto.randomUUID(),
          bidPrice: frontOrder!.price,
          buyerId: userId,
          sellerId: frontOrder!.userId,
          price: frontOrder!.price,
          qty: toExchangeQty,
          symbol,
        });

        frontOrder!.filledQty += toExchangeQty;
        currentOrder.filledQty += toExchangeQty;
        topOppositeSidePriceLevel.totalQuantity -= toExchangeQty;

        if (frontOrder!.filledQty == frontOrder!.qty) {
          // remove from orders and orderbook
          delete this.orders[frontOrder!.orderId];
          orders.popFront();
        }

        if (maxExchangeQty > toExchangeQty) {
          maxMarketBidSpend = 0;
          break;
        } else maxMarketBidSpend -= frontOrder!.price * toExchangeQty;
      }

      if (orders.empty()) {
        oppositeSideOrders.eraseElementByKey(topOppositeSidePrice);
      }
    }

    // save fills

    fillsToReturn.forEach((fill) => {
      this.fills[fill.fillId] = fill;
    });

    return {
      fillsInfo: fillsToReturn,
      newOrderId: currentOrder.orderId,
      totalFilledQuantity: currentOrder.filledQty,
    };
  };
  // could pass order directly here
  private placeMarketSellOrder = (
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    price: number,
    qty: number,
    userId: string,
  ) => {
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
      side,
      type,
      symbol,
    };

    let fillsToReturn: FILLS_INFO = [];

    let oppositeSideOrders = this.orderBook[symbol].BIDS;

    // try matching as much possible
    while (
      !oppositeSideOrders.empty() &&
      currentOrder.filledQty < currentOrder.qty
    ) {
      let [topOppositeSidePrice, topOppositeSidePriceLevel] =
        oppositeSideOrders.front()!;

      let orders = topOppositeSidePriceLevel.orders;

      assert(!orders.empty());

      while (currentOrder.filledQty < currentOrder.qty) {
        let frontOrder = orders.front();
        let pendingQty = frontOrder!.qty - frontOrder!.filledQty;

        let toExchangeQty = Math.min(
          currentOrder.qty - currentOrder.filledQty,
          pendingQty,
        );

        fillsToReturn.push({
          fillId: crypto.randomUUID(),
          bidPrice: Math.max(frontOrder!.price, currentOrder.price),
          sellerId: userId,
          buyerId: frontOrder!.userId,
          price: Math.min(frontOrder!.price, currentOrder.price),
          qty: toExchangeQty,
          symbol,
        });

        frontOrder!.filledQty += toExchangeQty;
        currentOrder.filledQty += toExchangeQty;
        topOppositeSidePriceLevel.totalQuantity -= toExchangeQty;

        if (frontOrder!.filledQty == frontOrder!.qty) {
          // remove from orders and orderbook
          delete this.orders[frontOrder!.orderId];
          orders.popFront();
        }
      }
      if (orders.empty()) {
        oppositeSideOrders.eraseElementByKey(topOppositeSidePrice);
      }
    }

    fillsToReturn.forEach((fill) => {
      this.fills[fill.fillId] = fill;
    });

    return {
      fillsInfo: fillsToReturn,
      newOrderId: currentOrder.orderId,
      totalFilledQuantity: currentOrder.filledQty,
    };
  };

  private placeLimitOrder = (
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    price: number,
    qty: number,
    userId: string,
  ) => {
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
      side,
      type,
      symbol,
    };

    let fillsToReturn: FILLS_INFO = [];

    let oppositeSideOrders;
    if (side == "BUY") oppositeSideOrders = this.orderBook[symbol].ASKS;
    else oppositeSideOrders = this.orderBook[symbol].BIDS;

    // try matching as much possible
    while (
      !oppositeSideOrders.empty() &&
      currentOrder.filledQty < currentOrder.qty
    ) {
      let [topOppositeSidePrice, topOppositeSidePriceLevel] =
        oppositeSideOrders.front()!;

      let orders = topOppositeSidePriceLevel.orders;

      if (
        side == "BUY"
          ? topOppositeSidePrice <= currentOrder.price
          : topOppositeSidePrice >= currentOrder.price
      ) {
        while (currentOrder.filledQty < currentOrder.qty && !orders.empty()) {
          let frontOrder = orders.front();
          let pendingQty = frontOrder!.qty - frontOrder!.filledQty;

          let toExchangeQty = Math.min(
            currentOrder.qty - currentOrder.filledQty,
            pendingQty,
          );

          fillsToReturn.push({
            fillId: crypto.randomUUID(),
            bidPrice: Math.max(frontOrder!.price, currentOrder.price),
            buyerId: side == "BUY" ? userId : frontOrder!.userId,
            sellerId: side == "SELL" ? userId : frontOrder!.userId,
            price: Math.min(frontOrder!.price, currentOrder.price),
            qty: toExchangeQty,
            symbol,
          });

          frontOrder!.filledQty += toExchangeQty;
          currentOrder.filledQty += toExchangeQty;
          topOppositeSidePriceLevel.totalQuantity -= toExchangeQty;

          if (frontOrder!.filledQty == frontOrder!.qty) {
            // remove from orders and orderbook
            delete this.orders[frontOrder!.orderId];
            orders.popFront();
          }
        }
        if (orders.empty()) {
          oppositeSideOrders.eraseElementByKey(topOppositeSidePrice);
        }
      } else break;
    }

    // for limit order
    // sit on orderbook for pending order
    if (currentOrder.filledQty < currentOrder.qty) {
      // put into orders object
      this.orders[currentOrder.orderId] = currentOrder;

      let prevPriceLevel: PRICE_LEVEL;

      if (side == "BUY")
        prevPriceLevel = this.orderBook[symbol].BIDS.getElementByKey(price) || {
          totalQuantity: 0,
          orders: new LinkList(),
        };
      else
        prevPriceLevel = prevPriceLevel = this.orderBook[
          symbol
        ].ASKS.getElementByKey(price) || {
          totalQuantity: 0,
          orders: new LinkList(),
        };

      prevPriceLevel.totalQuantity += currentOrder.qty - currentOrder.filledQty;
      prevPriceLevel.orders.pushFront(currentOrder);

      // put into orderbook object
      if (side == "BUY")
        this.orderBook[symbol].BIDS.setElement(price, prevPriceLevel);
      else this.orderBook[symbol].ASKS.setElement(price, prevPriceLevel);
    }

    fillsToReturn.forEach((fill) => {
      this.fills[fill.fillId] = fill;
    });

    return {
      fillsInfo: fillsToReturn,
      newOrderId: currentOrder.orderId,
      totalFilledQuantity: currentOrder.filledQty,
    };
  };

  createOrder = (
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    qty: number,
    userId: string,
    price?: number,
    maxMarketBidSpend?: number,
  ): {
    newOrderId: ORDER_ID;
    totalFilledQuantity: number;
    fillsInfo: FILLS_INFO;
  } => {
    let toReturn;
    if (type == "MARKET") {
      if (side == "BUY")
        toReturn = this.placeMarketBuyOrder(
          type,
          side,
          symbol,
          qty,
          userId,
          maxMarketBidSpend!,
        );
      else
        toReturn = this.placeMarketSellOrder(
          type,
          side,
          symbol,
          price!,
          qty,
          userId,
        );
    } else {
      toReturn = this.placeLimitOrder(type, side, symbol, price!, qty, userId);
    }

    // TODO : maintain depthUpdateOffset
    // TODO : find depthUpdateInfo
    type depthUpdateInfo = { price: number; qty: number };
    const depthUpdates: { asks: depthUpdateInfo[]; bids: depthUpdateInfo[] } = {
      asks: [],
      bids: [],
    };
    // TODO : setup event handler for this event, which will push to redis stream
    // TODO : emit depthUpdateEvent on global eventBus

    return toReturn;
  };

  cancelOrder = (
    orderId: ORDER_ID,
  ): {
    status: "NOT_CANCELLABLE" | "CANCELLED";
    order?: {
      filledQuantity: number;
      totalQuantity: number;
      price: number;
      side: SIDE;
      userId: string;
      symbol: CURRENCY_SYMBOL;
    };
  } => {
    //
    if (this.orders[orderId]) {
      // means its in order book right now
      let currentOrder = this.orders[orderId];
      let pendingQty = currentOrder.qty - currentOrder.filledQty;

      // remove from order object
      delete this.orders[orderId];

      //remove from orderbook
      let priceLevel;
      if (currentOrder.side == "BUY")
        priceLevel = this.orderBook[currentOrder.symbol]!.BIDS.getElementByKey(
          currentOrder.price,
        )!;
      else
        priceLevel = this.orderBook[currentOrder.symbol]!.ASKS.getElementByKey(
          currentOrder.price,
        )!;

      priceLevel.totalQuantity -= pendingQty;

      let findCurrentOrder = priceLevel.orders.begin();
      while (
        !findCurrentOrder.equals(priceLevel.orders.end()) &&
        findCurrentOrder.pointer.orderId != orderId
      ) {
        findCurrentOrder = findCurrentOrder.next();
      }

      if (findCurrentOrder.equals(priceLevel.orders.end())) throw new Error(); // TODO : MAKE THIS SOME ORDERBOOK ERROR LATER

      priceLevel.orders.eraseElementByIterator(findCurrentOrder);

      if (priceLevel.totalQuantity == 0)
        if (currentOrder.side == "BUY")
          this.orderBook[currentOrder.symbol]!.BIDS.eraseElementByKey(
            currentOrder.price,
          );
        else
          this.orderBook[currentOrder.symbol]!.ASKS.eraseElementByKey(
            currentOrder.price,
          );
    }
    return { status: "NOT_CANCELLABLE" };
  };

  getOrder = (orderId: ORDER_ID) => {
    if (this.orders[orderId]) return { ...this.orders[orderId] };

    if (false) {
      // check in db, etc if its already filled and is there
    }

    return null;
  };

  // count is how many prices you want
  getDepth = (
    symbol: CURRENCY_SYMBOL,
    count: number = 20,
  ): { asks: DEPTH; bids: DEPTH } => {
    let toReturn: { asks: DEPTH; bids: DEPTH } = { asks: [], bids: [] };

    if (!this.orderBook[symbol]?.ASKS) return toReturn;

    let countToReturn = Math.min(count, this.orderBook[symbol]!.ASKS.size());

    let i = 0;
    for (
      let it = this.orderBook[symbol]!.ASKS.begin();
      it != this.orderBook[symbol]!.ASKS.end() && i < countToReturn;
      it = it.next(), i++
    ) {
      toReturn.asks.push({
        price: it.pointer[0],
        quantity: it.pointer[1].totalQuantity,
      });
    }

    i = 0;
    for (
      let it = this.orderBook[symbol]!.BIDS.begin();
      it != this.orderBook[symbol]!.BIDS.end() && i < countToReturn;
      it = it.next(), i++
    ) {
      toReturn.bids.push({
        price: it.pointer[0],
        quantity: it.pointer[1].totalQuantity,
      });
    }

    return toReturn;
  };
}
