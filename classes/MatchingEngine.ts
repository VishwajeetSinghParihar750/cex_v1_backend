import OrderBook from "./OrderBook.js";
import Balances from "./Balances.js";
import type { CURRENCY_SYMBOL, ORDER_ID, SIDE, TYPE } from "../types/order.js";
import { InsufficientBalanceError } from "./Errors/MatchingEngine.js";

export default class MatchingEngine {
  private balances: Balances;
  private orderBook: OrderBook;

  constructor() {
    this.balances = new Balances();
    this.orderBook = new OrderBook();
  }

  createOrder(
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    price: number,
    qty: number,
    userId: string,
  ): { status: "REJECTED" | "OPEN" | "FILLED"; orderId: ORDER_ID } {
    if (side == "BUY") {
      // check balance

      const neededBal = price * qty;
      const availBal = this.balances.getBalance(userId, symbol);

      if (neededBal > availBal) throw new InsufficientBalanceError();

      // deduct bidders balance
      this.balances.removeBalance(userId, symbol, neededBal);
    } else {
      // check balance
      const availBal = this.balances.getBalance(userId, symbol);
      if (availBal < qty) throw new InsufficientBalanceError();

      // deduct askers balance
      this.balances.removeBalance(userId, symbol, qty);
    }

    // place order in orderbook, get back fills
    let { newOrderId, fillsInfo, totalFilledQuantity } =
      this.orderBook.createOrder(type, side, symbol, price, qty, userId);

    // update balances based on fills
    fillsInfo.forEach(
      ({ buyerId, sellerId, price, bidPrice, qty, symbol: filledSymbol }) => {
        // add and remove , coz there might be gap in bid and ask, and we dont want floating point errors, so return whole money first
        this.balances.addBalance(buyerId, "USD", bidPrice * qty - price * qty);

        this.balances.addBalance(buyerId, filledSymbol, qty);
        this.balances.addBalance(sellerId, "USD", price * qty);
      },
    );

    // return new order info
    return {
      status: totalFilledQuantity == qty ? "FILLED" : "OPEN",
      orderId: newOrderId,
    };
  }

  cancelOrder(orderId: ORDER_ID): {
    status: "CANCELLED" | "ALREADY_FILLED" | "NOT_CANCELLABLE";
  } {
    try {
      // try cancelling order
      // get pendign fills and abort it
      const { status, order } = this.orderBook.cancelOrder(orderId);

      if (status == "NOT_CANCELLABLE") {
        return { status: "NOT_CANCELLABLE" };
      }

      const { filledQuantity, totalQuantity, price, side, userId, symbol } =
        order!;

      if (filledQuantity == totalQuantity) {
        return { status: "ALREADY_FILLED" };
      }

      // return back balances
      if (side == "BUY") {
        this.balances.addBalance(
          userId,
          "USD",
          totalQuantity * price - filledQuantity * price,
        );
      } else {
        this.balances.addBalance(
          userId,
          symbol,
          totalQuantity - filledQuantity,
        );
      }
      return {
        status: "CANCELLED",
      };
    } catch (error) {
      // if order doesnt exist etc, or already filled
      // would have to see some error handling here , maybe we need entity baesd errors like ordererror, balanceerror isntead of class based
      throw error;
    }
  }

  getOrder(orderId: ORDER_ID) {
    return this.orderBook.getOrder(orderId);
  }

  getBalance(userId: string, symbol: CURRENCY_SYMBOL) {
    return this.balances.getBalance(userId, symbol);
  }
  addBalance(userId: string, amount: number) {
    // u can only deposit usd
    this.balances.addBalance(userId, "USD", amount);
  }
  getDepth(symbol: CURRENCY_SYMBOL) {
    return this.orderBook.getDepth(symbol);
  }
}
