# Moonlight

Backend API to support the DeFi architecture provided by [DeFi Sandbox](https://github.com/s1ddhi/DeFiSandbox).

The database this interacts with is a MongoDB database provided by [moonlight MongoDB](https://github.com/s1ddhi/moonlight-mongodb).

## Endpoints

Curve specific endpoints are as follows:

- POST: `/curve/depositRequest`

Request schema:

```
{
    "user": "string",
    "requestedDeposit": number,
    "currency ": number
}
```

Successful respsones will echo back the request body.

- POST: `/curve/withdrawRequest`

Request schema:

```
{
    "user": "string",
    "requestedWithdrawal ": number,
    "currency": "string"
}
```
Successful respsones will echo back the request body.

---

These submit requests to the `ledger` collection of the MongoDB database.

General endpoints:

- PUT: `/userBalance`

Request schema:

```
{
    "user": "string",
    "currency": "string"
}
```

Response schema:

```
{
    "baseDepositBalance ": number ,
    "accruedBalance ": number ,
    "currency": "string",
    "apy": number
}
```

This fetches user balances of a particular currency. Currency conversion is based on information fetched from [CoinGecko](https://www.coingecko.com/en/api/documentation).

## Daily Tasks

There are 3 daily tasks that are run to update user balances and perform on-chain deposit and withdraw transactions:

1. Fetching today's APYs from Convex's oracle
2. Update pre-existing balances with interest
3. Batching of requests on-chain and proportioning assets

These tasks can be found in the `src/backgroundTasks.js` file and should be run in the background,

They are set to run at 1 minute to midnight as part of the cron job, in the order specified above.