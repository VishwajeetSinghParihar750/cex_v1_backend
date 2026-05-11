import express from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { OrderType, PrismaClient } from "./generated/prisma/client.js";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { OrderedMap, Queue } from "js-sdsl";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(express.json());

type ORDER_TYPE = {
  userId: string;
  qty: number;
  filledQty: number;
  orderId: string;
  createdAt: Date;
};
type PRICE_LEVEL_TYPE = { totalQuantity: number; orders: Queue<ORDER_TYPE> };

const BALANCES: Record<string, Record<string, number>> = {};
// user_id to stock_id to balance matching

const ORDERBOOKS: Record<
  string,
  {
    BIDS: OrderedMap<number, PRICE_LEVEL_TYPE>;
    ASKS: OrderedMap<number, PRICE_LEVEL_TYPE>;
  }
> = {
  SOL: { BIDS: new OrderedMap(), ASKS: new OrderedMap([], (x, y) => y - x) },
};

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ error: true, result: "unauthorized" });
    return;
  }
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET_KEY!,
    ) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: true, result: "unauthorized" });
  }
}
app.post("/signup", async (req, res) => {
  //
  try {
    const { username, password } = req.body;
    const findUser = await prisma.users.findUnique({
      where: { username },
    });
    if (findUser) {
      res.status(403).json({ error: true, result: "username already exists" });
      return;
    }
    const user = await prisma.users.create({ data: { username, password } });

    BALANCES[user.id!] = { USD: 0 };

    res.status(201).json({ error: false, result: user.id });
  } catch (e) {
    res.status(500).json({ error: true, result: "server error" });
  }
});

app.post("/signin", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.users.findUnique({
      where: { username },
    });
    if (!user || user.password != password) {
      res.status(400).json({ error: true, result: "incorrect credentials" });
      return;
    }

    const jwt_token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET_KEY!,
    );

    res.status(200).json({
      error: false,
      result: {
        jwt_token,
      },
    });
  } catch (error) {
    res.status(500).json({ error: true, result: "server error" });
  }
});

app.post("/deposit", authMiddleware, async (req, res) => {
  const { id } = req;
  const { usd } = req.body;

  BALANCES[id]!["USD"] += usd;
  res.status(200).json({ error: false, result: BALANCES[id]!["USD"] });
});
// /*
//     body = {
//         type:           "market" | "limit",
//         price:          number | null,
//         qty:            number,
//         market_id:      string,
//         side:           "buy" | "sell"
//     }

//     @returns {
//         orderId: string,
//         filledQty: number,
//         averagePrice
//     }
// */

// // 50.01

// // 500001
const USD_BALANCE_ID = "USD";

const matchOrders = async (stock_id: string) => {
  if (!ORDERBOOKS[stock_id]) return;

  let bids = ORDERBOOKS[stock_id].ASKS;
  let asks = ORDERBOOKS[stock_id].BIDS;

  // fill orders
  // change order book first

  while (!bids.empty() && !asks.empty()) {
    let [topBidPrice, topBids] = bids.front()!;
    let [topAskPrice, topAsks] = asks.front()!;

    if (topBidPrice < topAskPrice) break;

    while (!topBids.orders.empty() && !topAsks.orders.empty()) {
      let currentBidOrder = topBids.orders.front();
      let currentAskOrder = topAsks.orders.front();

      let pendingBidQty = currentBidOrder!.qty - currentBidOrder!.filledQty;
      let pendingAskQty = currentAskOrder!.qty - currentAskOrder!.filledQty;

      let toExchangeQty = Math.min(pendingBidQty, pendingAskQty);
      currentBidOrder!.filledQty += toExchangeQty;
      currentAskOrder!.filledQty += toExchangeQty;

      // change balance

      topBids.totalQuantity -= toExchangeQty;
      topAsks.totalQuantity -= toExchangeQty;

      if (!BALANCES[currentAskOrder!.userId])
        BALANCES[currentAskOrder!.userId] = { USD_BALANCE_ID: 0 };
      else if (!BALANCES[currentAskOrder!.userId]![USD_BALANCE_ID])
        BALANCES[currentAskOrder!.userId]![USD_BALANCE_ID] = 0;

      BALANCES[currentAskOrder!.userId]![USD_BALANCE_ID]! +=
        toExchangeQty * topBidPrice;

      if (!BALANCES[currentBidOrder!.userId])
        BALANCES[currentBidOrder!.userId] = { stock_id: 0 };
      else if (!BALANCES[currentBidOrder!.userId]![stock_id]) {
        BALANCES[currentBidOrder!.userId]![stock_id] = 0;
      }

      BALANCES[currentBidOrder!.userId]![stock_id]! += toExchangeQty;

      // also return extra usd to bidder ( diff between bid and ask ) TODO _____________________________________

      // put fill in db
      await prisma.fills.create({
        data: {
          price: topAskPrice,
          quantity: toExchangeQty,
          buyOrderId: currentBidOrder!.orderId,
          sellOrderId: currentAskOrder!.orderId,
          stockId: stock_id,
        },
      });
      await prisma.orders.update({
        where: {
          id: currentBidOrder!.orderId,
        },
        data: {
          filledQuantity: currentBidOrder!.filledQty,
        },
      });
      await prisma.orders.update({
        where: {
          id: currentAskOrder!.orderId,
        },
        data: {
          filledQuantity: currentAskOrder!.filledQty,
        },
      });

      // changing price levels
      if (currentBidOrder!.filledQty == currentBidOrder!.qty) {
        topBids.orders.pop();
        await prisma.orders.update({
          where: { id: currentBidOrder!.orderId },
          data: { status: "FILLED" },
        });
      }
      if (currentAskOrder!.filledQty == currentAskOrder!.qty) {
        topAsks.orders.pop();
        await prisma.orders.update({
          where: { id: currentAskOrder!.orderId },
          data: { status: "FILLED" },
        });
      }
    }

    // changing orderbook
    if (topBids.totalQuantity == 0) bids.eraseElementByKey(topBidPrice);
    if (topAsks.totalQuantity == 0) asks.eraseElementByKey(topAskPrice);
  }
};

app.post("/order", authMiddleware, async (req, res) => {
  const { type, price, qty, stock_id, side } = req.body;

  const { id: userId } = req;

  if (side == "BID") {
    // check balance
    const usd_balance = BALANCES[userId]?.[USD_BALANCE_ID];
    const required_bal = price * qty;
    if (!usd_balance || required_bal > usd_balance) {
      res.status(402).json({ error: true, result: "insufficient balalance" });
      return;
    }

    // insert inot order db
    // ie. make db changes
    const placedOrder = await prisma.orders.create({
      data: {
        filledQuantity: 0,
        price,
        quantity: qty,
        side,
        status: "OPEN",
        type,
        stockId: stock_id,
        userId: userId,
      },
    });

    // do local data changes
    if (!ORDERBOOKS[stock_id])
      ORDERBOOKS[stock_id] = { BIDS: new OrderedMap(), ASKS: new OrderedMap() };

    let priceLvlData = ORDERBOOKS[stock_id].BIDS.getElementByKey(price);
    if (!priceLvlData) {
      ORDERBOOKS[stock_id].BIDS.setElement(price, {
        totalQuantity: 0,
        orders: new Queue(),
      });
      priceLvlData = ORDERBOOKS[stock_id].BIDS.getElementByKey(price);
    }

    priceLvlData!.totalQuantity += qty;
    priceLvlData!.orders.push({
      userId: userId,
      createdAt: new Date(),
      filledQty: 0,
      qty: qty,
      orderId: placedOrder.id,
    });

    BALANCES[userId]![USD_BALANCE_ID]! -= required_bal;
  } else {
    // check balance
    const avail_qty = BALANCES[userId]?.[stock_id];

    if (!avail_qty || avail_qty < qty) {
      res.status(402).json({ error: true, result: "insufficient quantity" });
      return;
    }

    // insert order into db
    const placedOrder = await prisma.orders.create({
      data: {
        filledQuantity: 0,
        price,
        quantity: qty,
        side,
        status: "OPEN",
        type,
        stockId: stock_id,
        userId: userId,
      },
    });

    // do local data changes
    if (!ORDERBOOKS[stock_id])
      ORDERBOOKS[stock_id] = { BIDS: new OrderedMap(), ASKS: new OrderedMap() };

    let newtotalQuantity = 0;
    let newOrders: Queue<ORDER_TYPE> = new Queue();

    let prevInfo = ORDERBOOKS[stock_id].ASKS.getElementByKey(price);
    if (prevInfo) {
      newtotalQuantity = prevInfo.totalQuantity;
      newOrders = prevInfo.orders;
    }

    newtotalQuantity += qty;
    newOrders.push({
      userId: userId,
      createdAt: new Date(),
      filledQty: 0,
      qty: qty,
      orderId: placedOrder.id,
    });

    ORDERBOOKS[stock_id].ASKS.setElement(price, {
      totalQuantity: newtotalQuantity,
      orders: newOrders,
    });

    BALANCES[userId]![stock_id]! -= avail_qty;
  }

  // try matching
  await matchOrders(stock_id);
});
/*
    returns the status of an order (partially filled, success, cancellled)
    ALSO RETURNS THE INDIVIDUAL FILLS OF THIS ORDER
*/
app.get("/order/:orderId", authMiddleware, async (req, res) => {});
app.delete("/order/:orderId", authMiddleware, (req, res) => {});
app.get("/depth/:symbol", async (req, res) => {});

app.get("/orders", authMiddleware, async (req, res) => {
  try {
    const orders = await prisma.orders.findMany();
    res.status(200).json({ error: false, result: orders });
  } catch (error) {
    res.status(500).json({ error: "server error", result: null });
  }
});

app.get("/fills", async (req, res) => {
  try {
    const fills = await prisma.fills.findMany();
    res.status(200).json({ error: false, result: fills });
  } catch (error) {
    res.status(500).json({ error: "server error", result: null });
  }
});

app.get("/balance/usd", authMiddleware, (req, res) => {
  const { id } = req;
  res
    .status(200)
    .json({ error: false, result: BALANCES?.[id]?.[USD_BALANCE_ID] || 0 });
});

// /*
//     Returns the balance of all stocks
// */
app.get("/balance", authMiddleware, (req, res) => {
  const { id } = req.body;
  res.status(200).json({ error: false, result: BALANCES[id] });
});

app.listen(3000);
