import express from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import jwt, { type JwtPayload } from "jsonwebtoken";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(express.json());

const BALANCES = {};

const ORDERBOOKS = {
  SOL: {},
  BTC: {},
};

const authMiddleware = (req, res, next) => {
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
};
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
    res.status(201).json({ error: false, result: user.id });
  } catch (e) {
    res.status(500).json({ error: true, result: "user creation failed" });
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
    res.status(500).json({ error: true, result: "login failed" });
  }
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
app.post("/order", authMiddleware, async (req, res) => {
  const { type, price, qty, stock_id, side } = req.body;

  //
});
/*
    returns the status of an order (partially filled, success, cancellled)
    ALSO RETURNS THE INDIVIDUAL FILLS OF THIS ORDER
*/
app.get("/order/:orderId");
app.delete("/order/:orderId", (req, res) => {});
app.get("/depth/:symbol");
app.get("/orders");
app.get("/fills");

app.get("/balance/usd");

// /*
//     Returns the balance of all stocks
// */
app.get("/balance");

app.listen(3000);
