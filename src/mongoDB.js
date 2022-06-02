const MongoClient = require('mongodb').MongoClient;
const startOfToday = require('date-fns/startOfToday');
const zonedTimeToUtc = require('date-fns-tz/zonedTimeToUtc');

const url = 'mongodb://127.0.0.1:27017';
const baseDB = 'quirk-moonlight';

let myDB;

const loadDB = async () => {
    if (myDB) {
        return myDB;
    }

    try {
        const client = await MongoClient.connect(url);
        myDB = client.db(baseDB);
    } catch (err) {
        console.log("Error connecting to MongoDB instance", err);
    }

    console.log(`MongoDB Connected: ${url}`);

    return myDB;
}

const findAll = async (_db, collection) => {
    const dbCollection = _db.collection(collection);

    return(await dbCollection.find({}).sort({"date": 1}).toArray());
};

const findToday = async(_db, collection) => {
    const dbCollection = _db.collection(collection);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const boundary = zonedTimeToUtc(today, 'UTC');
    console.log("Time Boundary:", boundary.toDateString(), boundary.toTimeString(), boundary);

    return(await dbCollection.find(
        {
            "date": {$gte: boundary}
        }).toArray());
};

const findByUserID = async (_db, collection, user) => {
    const dbCollection = _db.collection(collection);

    return(await dbCollection.find({ user }).toArray());
};

const findUserIDBalance = async (_db, collection, user, type) => {
    const dbCollection = _db.collection(collection);

    const result = await dbCollection.aggregate([
        {
            $match: { user, type }
        },
        {
            $group: {
                _id: null,
                daiTotal: {
                    $sum: "$amounts.dai"
                },
                usdcTotal: {
                    $sum: "$amounts.usdc"
                },
                usdtTotal: {
                    $sum: "$amounts.usdt"
                }
            }
        }
    ]).toArray();

    if(result.length == 0) {
        return 0; // TODO define empty
    }

    delete result[0]._id;

    return result[0];
};

const findTotals = async (_db, collection, type) => {
    const dbCollection = _db.collection(collection);

    const result = await dbCollection.aggregate([
        {
            $match: { type }
        },
        {
            $group: {
                _id: null,
                daiTotal: {
                    $sum: "$amounts.dai"
                },
                usdcTotal: {
                    $sum: "$amounts.usdc"
                },
                usdtTotal: {
                    $sum: "$amounts.usdt"
                }
            }
        }
    ]).toArray();

    if(result.length == 0) {
        return 0;
    }

    delete result[0]._id;

    return result[0];
};

const DEPOSIT_TYPE = 'deposit';

const findUserProportions = async (_db, collection, user, action) => {
    const totalDeposits = await findTotals(_db, collection, DEPOSIT_TYPE);
    const aggregatedTotalDeposits = aggregate(totalDeposits);
    const userDeposits = await findUserIDBalance(_db, collection, user, action);
    const aggregatedUserDeposits = aggregate(userDeposits);

    return aggregatedUserDeposits / aggregatedTotalDeposits;
};

const aggregate = (obj) => {
    return Object.values(obj).reduce((a, b) => a + b);
};

const insertDocument = async (_db, collection, document) => {
    const dbCollection = _db.collection(collection);

    document.date = new Date();

    console.log(document);

    dbCollection.insertOne(document, (err, result) => {
        if (err) {
            return console.log(`Error inserting document: ${document} into collection ${collection}`, err);
        }
    })
};

const updateDocument = async (_db, collection, user, document) => {
    document.date = new Date();
    const dbCollection = _db.collection(collection);

    await dbCollection.replaceOne({"_id": document._id}, document);
};

const closeDB = async (_db) => {
    await _db.close();
    console.log('Connection closed with MongoDB');
};

module.exports = { loadDB, findByUserID, findUserIDBalance, findTotals, findUserProportions, insertDocument, closeDB, findAll, findToday, updateDocument };