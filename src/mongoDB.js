const MongoClient = require('mongodb').MongoClient;

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

const findByUserID = async (_db, collection, userId) => {
    const dbCollection = _db.collection(collection);

    return(await dbCollection.find({ user }).toArray());
};

const findUserIDBalance = async (_db, collection, user, action) => {
    const dbCollection = _db.collection(collection);

    const result = await dbCollection.aggregate([
        {
            $match: { user, action }
        },
        {
            $group: {
                _id: null,
                total: {
                    $sum: "$amount"
                }
            }
        }
    ]).toArray();

    return result[0].total;
};

const insertDocument = async (_db, collection, document) => {
    const dbCollection = _db.collection(collection);

    dbCollection.insertOne(document, (err, result) => {
        if (err) {
            return console.log(`Error inserting document: ${document} into collection ${collection}`, err);
        }
    })
};

const closeDB = async (_db) => {
    await _db.close();
    console.log('Connection closed with MongoDB');
};

module.exports = { loadDB, findByUserID, findUserIDBalance, insertDocument, closeDB };