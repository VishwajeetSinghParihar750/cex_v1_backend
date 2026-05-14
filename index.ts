import "dotenv/config";
import MatchingEngine from "./classes/MatchingEngine.js";
import { createClient } from "redis";
import EventBus from "./classes/EventBus.js";

// TODO : put all this logic in a class from this file, A CENTRAL INTERFACE
// so index is empty and u simpply initialize that class here

const redisClient = createClient({ url: process.env.REDIS_URL! });
const globalEventBus = new EventBus();
const matchingEngine = new MatchingEngine(globalEventBus);

const setupEventHandler = () => {
  globalEventBus.on("ALL_EVENTS", (event) => {
    redisClient.xAdd(event.type, "*", { data: JSON.stringify(event.data) });
  });
};

type ENGINE_REQUEST_TYPE =
  | "create_order"
  | "cancel_order"
  | "get_balance"
  | "add_balance"
  | "get_depth"
  | "get_orders"
  | "get_order"
  | "get_fills";

type ENGINE_RESPONSE_TYPE =
  | "order_created"
  | "order_cancelled"
  | "balance"
  | "balance_updated"
  | "depth"
  | "orders"
  | "order"
  | "fills"
  | "error"; // for anything that did not succeed

type ENGINE_REQUEST = {
  requestId: string;
  type: ENGINE_REQUEST_TYPE;
  payload?: any;
};
type ENGINE_RESPONSE = {
  requestId: string;
  type: ENGINE_RESPONSE_TYPE;
  payload?: any;
};

const handleGetDepthRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let depth = matchingEngine.getDepth(engineRequest.payload.symbol);
    return {
      requestId: engineRequest.requestId,
      type: "depth",
      payload: depth,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleGetOrdersRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let orders = matchingEngine.getOrders();
    return {
      requestId: engineRequest.requestId,
      type: "orders",
      payload: orders,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleGetFillsRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let fills = matchingEngine.getFills();
    return {
      requestId: engineRequest.requestId,
      type: "fills",
      payload: fills,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};
const handleGetOrderRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let order = matchingEngine.getOrder(engineRequest.payload.orderId);
    if (!order) throw new Error();

    return {
      requestId: engineRequest.requestId,
      type: "order",
      payload: order,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};
const handleGetBalanceRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let balance = matchingEngine.getBalance(
      engineRequest.payload.userId,
      engineRequest.payload.symbol,
    );
    return {
      requestId: engineRequest.requestId,
      type: "balance",
      payload: balance,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleCancelOrderRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let { status } = matchingEngine.cancelOrder(engineRequest.payload.orderId);
    if (status != "CANCELLED") throw new Error();

    return { requestId: engineRequest.requestId, type: "order_cancelled" };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleCreateOrderRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    const { type, side, price, qty, symbol, userId } = engineRequest.payload;
    let { status, orderId, fills } = matchingEngine.createOrder(
      type,
      side,
      symbol,
      qty,
      userId,
      price,
    );
    if (status == "REJECTED")
      return {
        requestId: engineRequest.requestId,
        type: "error",
        payload: "ORDER_REJECTED",
      };

    return {
      requestId: engineRequest.requestId,
      type: "order_created",
      payload: { status, fills, orderId },
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleAddBalanceRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    matchingEngine.addBalance(
      engineRequest.payload.userId,
      engineRequest.payload.amount,
      engineRequest.payload.symbol,
    );
    return { requestId: engineRequest.requestId, type: "balance_updated" };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleEngineRequest = (engineRequest: ENGINE_REQUEST) => {
  let response;
  switch (engineRequest.type) {
    case "add_balance":
      response = handleAddBalanceRequest(engineRequest);
      break;
    case "cancel_order":
      response = handleCancelOrderRequest(engineRequest);
      break;

    case "create_order":
      response = handleCreateOrderRequest(engineRequest);
      break;
    case "get_balance":
      response = handleGetBalanceRequest(engineRequest);
      break;
    case "get_depth":
      response = handleGetDepthRequest(engineRequest);
      break;
    case "get_fills":
      response = handleGetFillsRequest(engineRequest);
      break;
    case "get_order":
      response = handleGetOrderRequest(engineRequest);
      break;
    case "get_orders":
      response = handleGetOrdersRequest(engineRequest);
      break;

    default:
      break;
  }

  redisClient.rPush(
    `engine_response_${engineRequest.requestId}`,
    JSON.stringify(response),
  );
};

const setupEngine = async () => {
  redisClient.on("error", (err) => {
    console.log("redis error : ", err);
  });

  setupEventHandler();

  await redisClient.connect();
  console.log("REDIS SETUP DONE, WAITING FOR ENGINE REQUESTS");

  while (true) {
    const engineRequest = await redisClient.blPop("engine_request", 0);
    console.log("RECEIVED ENGINE REQUEST : ", engineRequest);
    if (engineRequest) handleEngineRequest(JSON.parse(engineRequest.element));
  }
};

await setupEngine();
