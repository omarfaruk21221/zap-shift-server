const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// ----strip =---
const stripe = require('stripe')(process.env.STRIPE);

const port = process.env.PORT || 3000

// ------ firebase admin ---------
const admin = require("firebase-admin");
const serviceAccount = require("./zap-shift-c9e57-firebase.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// --genared tokon ---
const crypto = require("crypto");
const { access } = require('fs');

function generateTrackingId() {
    const prefix = "PRCL"; // your brand prefix
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex
    return `${prefix}-${date}-${random}`;
}

/// middleware
app.use(express.json())
app.use(cors())


const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization
    // console.log('headers in the middleware', token)
    if (!token) {
        return res.status(401).send({ massage: 'unauthorization access' })
    }
    try {
        const idToken = token.split(" ")[1]
        const decode = await admin.auth().verifyIdToken(idToken)
        console.log({ decode })
        req.decode_email = decode.email
        next()
    }
    catch (err) {
        return res.status(401).send({ massage: "unathorized access!!" })
    }
    // const tol


}


// ----- mongodb----
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.zfo7i3z.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
// ---connection -----
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // ====create Database =====
        const db = client.db("zpa_shift_DB");
        const parcelCollection = db.collection("parcels");
        const paymentCollection = db.collection("payments");
        const userCollection = db.collection("uesrs");
        const riderCollection = db.collection("riders");
        //// middleware with database
        const verifyAdmin = async (req, res, next) => {
            const email = req.decode_email;
            const query = { email }
            const user = await userCollection.findOne(query)
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ massage: 'forbidden access' })
            }
            next()
        }

        //====== user related Api ======
        app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText
            const query = {}
            if (searchText) {
                // query.displayName = { $regex: searchText, $options: 'i' }
                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } }
                ]
            }
            const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(3)
            const result = await cursor.toArray()
            res.send(result)
        })

        // app.get('/users/:id', async (req, res) => {

        // })
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email });
            res.send({ role: user?.role || 'user' });
        });

        app.post('/users', async (req, res) => {
            const user = req.body
            user.role = 'user'
            user.createdAt = new Date()
            const email = user.email
            const userExist = await userCollection.findOne({ email: email });
            if (userExist) {
                return res.send({ massage: "User Existed" })
            }
            const result = await userCollection.insertOne(user)
            res.send(result)
        })

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const roleInfo = req.body
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updatedDoc)
            res.send(result)
        })
        ///// Rider APIs
        // ---create Rider post ---
        app.post('/riders', async (req, res) => {
            const riderInfo = req.body
            riderInfo.status = "pending.."
            riderInfo.createdAt = new Date()
            const result = await riderCollection.insertOne(riderInfo)
            res.send(result)
        })
        // ---get  Rider data status bage ---
        app.get('/riders', async (req, res) => {
            const { status, district, workStatus } = req.query
            const query = {}
            if (status) {
                query.status = status
            }
            if (district) {
                query.riderDistrict = district
            }
            if (workStatus) {
                query.workStatus = workStatus
            }
            const cursor = riderCollection.find(query)
            const result = await cursor.toArray()
            res.send(result)
        })
        // upadate status of riders
        app.patch('/riders/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const status = req.body.status
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: status,
                    workStatus: 'available'
                }
            }
            const result = await riderCollection.updateOne(query, updateDoc)
            if (status === 'approved') {
                const email = req.body.email
                const userQuery = { email }
                const updateUser = {
                    $set: { role: 'rider' }
                }
                const result = await userCollection.updateOne(userQuery, updateUser);
                res.send(result)
            }
            res.send(result)
        })

        /// reject rider api
        app.delete(`/riders/:id`, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await riderCollection.deleteOne(query)
            res.send(result)
        })

        // --- parcel api ---
        app.get('/parcels', async (req, res) => {
            // console.log(res)
            const query = {}
            const { email, deliveryStatus } = req.query
            // // parcel?email=&name=
            if (email) {
                query.senderEmail = email
            }
            if (deliveryStatus) {
                query.deliveryStatus = deliveryStatus
            }
            const options = { sort: { createdAt: -1 } }
            const cursor = parcelCollection.find(query, options)
            const result = await cursor.toArray()
            res.send(result)
        })
        app.get(`/parcels/:id`, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await parcelCollection.findOne(query)
            res.send(result)
        })
        app.post('/parcels', async (req, res) => {
            // console.log(req)
            const parcel = req.body
            //parcel created time
            parcel.createdAt = new Date()
            const result = await parcelCollection.insertOne(parcel)
            res.send(result)
        })
        app.patch('/parcels/:id', async (req, res) => {
            const { riderId, riderName, riderEmail, rideContact } = req.body
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {

                    deliveryStatus: 'driver_assigned',
                    riderId: riderId,
                    riderName: riderName,
                    riderEmail: riderEmail,
                    rideContact: rideContact
                }
            }
            const result = await parcelCollection.updateOne(query, updatedDoc)
            //// update rider information
            const riderQuery = { _id: new ObjectId(riderId) }
            const riderupdatedDoc = {
                $set: {
                    workStatus: "In_ delivery"
                }
            }
            const riderResult = await riderCollection.updateOne(riderQuery, riderupdatedDoc)
            res.send(riderResult)

        })
        app.delete(`/parcels/:id`, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await parcelCollection.deleteOne(query)
            res.send(result)
        })

        // -------payment reledated api ---------

        /// get payment data
        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {}
            // console.log(req.headers)
            if (email) {
                query.customerEmail = email;
                ///cheack email adrees
                if (email !== req.decode_email) {
                    return res.status(403).send({ massage: 'forbiden access' })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 })
            const result = await cursor.toArray()
            res.send(result)

        })

        // --PAYMENT DATA CREATE AND POST JDATA BASE ---
        app.post('/payment-checkout-session', async (req, res) => {
            const paymentInfo = req.body
            const amount = Number(paymentInfo.cost)
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount * 100,
                            product_data: {
                                name: `please pay for ${paymentInfo.parcelName}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId,
                    parcelName: paymentInfo.parcelName
                },
                customer_email: paymentInfo.senderEmail,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cencelled`
            })
            res.send({ url: session.url })
        })
        // ---- old ---
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body
            const amount = parseInt(paymentInfo.cost) * 100
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.parcelName,
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId,
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cencelled`,
            });
            console.log(session)
            res.send({ url: session.url })
        })

        // -payment data added and  upadet --
        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId)
            const trackingId = generateTrackingId()

            // ----stop data dubble ---------
            const transactionalId = session.payment_intent
            const query = { transactionalId: transactionalId }
            const paymentExist = await paymentCollection.findOne(query)
            console.log(paymentExist)
            if (paymentExist) {
                return res.send({
                    massage: 'Already Exist this Parcel', transactionalId,
                    trackingId: paymentExist.trackingId
                })
            }

            if (session.payment_status === 'paid') {
                const id = session.metadata.parcelId
                const query = { _id: new ObjectId(id) }
                const updateData = {
                    $set: {
                        paymentStatus: 'paid',
                        deliveryStatus: 'pending-pickup',
                        trackingId: trackingId

                    }
                }
                const result = await parcelCollection.updateOne(query, updateData)
                const paymentData = {
                    customerEmail: session.customer_email,
                    currency: session.currency,
                    amount: session.amount_total / 100,
                    paymentStatus: session.payment_status,
                    parcelId: session.metadata.parcelId,
                    parcelName: session.metadata.parcelName,
                    transactionalId: session.payment_intent,
                    trackingId: trackingId,
                    paidAt: new Date()
                }
                if (session.payment_status === 'paid') {
                    const paymentResult = await paymentCollection.insertOne(paymentData)
                    res.send({
                        success: true,
                        trackingId: trackingId,
                        transactionalId: session.payment_intent,
                        modifyParcel: result,
                        paymentInfo: paymentResult,

                    })
                }
            }
            console.log('seeion :', session)
            res.send({ success: false })
        })




        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);
// ---- output Api ----
app.get('/', (req, res) => {
    res.send('Zap Shift Server is runing bro!!!!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})