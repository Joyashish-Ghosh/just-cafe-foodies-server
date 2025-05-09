const express = require("express");
const axios = require("axios");
const SSLCommerzPayment = require("sslcommerz-lts");

const app = express();
const cors = require("cors");

const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded());

const store_id = process.env.SSL_COMMERZ_STORE_ID;
const store_passwd = process.env.SSL_COMMERZ_STORE_PASSWORD;
const is_live = false;

const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  CURSOR_FLAGS,
} = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5ranbba.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0 `;
// console.log(process.env.DB_USER, process.env.DB_PASS);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // Get the database and collection on which to run the operation
    const userCollection = client.db("cafeDB").collection("users");
    const menuCollection = client.db("cafeDB").collection("menu");
    const reviewCollection = client.db("cafeDB").collection("reviews");
    const cartCollection = client.db("cafeDB").collection("carts");
    const paymentCollection = client.db("cafeDB").collection("payments");
    const charityCollection = client.db("cafeDB").collection("charity");
    const kitchenOrdersCollection = client.db("cafeDB").collection("kitchenOrders");


    //jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    //middlewares
    const verifyToken = (req, res, next) => {
      console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: " unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    //use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      console.log(req.headers);
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    //chef check
    app.get("/users/chef/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let chef = false;
      if (user) {
        chef = user?.role === "chef";
      }
      res.send({ chef });
    });

    app.get("/chef/status", async (req, res) => {
      let result = await paymentCollection.find().toArray();
      res.send(result);
    });

    app.put("/chef/wait-time/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { newWaitingTime } = req.body;
    
        const query = { _id: new ObjectId(id) };
        const item = await paymentCollection.findOne(query);
    
        if (!item) {
          return res.send({ result: false });
        }
    
        const updateDoc = {
          $set: {
            waiting_time: newWaitingTime,
          },
        };
    
        const result = await paymentCollection.updateOne(query, updateDoc);
    
        res.send({ result: result.modifiedCount > 0 });
      } catch (error) {
        console.error("Error updating wait time:", error);
        res.status(500).send({ result: false, error: "Server error" });
      }
    });
    
// wwaiter-role
app.post("/waiter/submit", async (req, res) => {
  try {
    const order = req.body;

    console.log("Received order from frontend:", order);

    if (!order || !order.order_id || !Array.isArray(order.cart)) {
      console.error("Invalid order payload:", order);
      return res.status(400).send({ success: false, message: "Invalid order data" });
    }

    // Add extra fields before insert
    order.status = "Completed";
    order.submittedAt = new Date();

    const result = await kitchenOrdersCollection.insertOne(order);
    res.send({ success: true, insertedId: result.insertedId });

  } catch (error) {
    console.error("❌ Error submitting order to kitchen:", error);
    res.status(500).send({ success: false, message: "Server error" });
  }
});


//chef-wait-time
app.put("/chef/wait-time/:id", async (req, res) => {
  const { newWaitingTime } = req.body;  // Get the new waiting time from the request
  const { id } = req.params;  // Get the item ID from the URL parameter

  const query = { _id: new ObjectId(id) };  // Query for the item by ID
  const item = await paymentCollection.findOne(query);

  if (item) {
    // If the item exists, update the waiting time
    const updatedDoc = {
      $set: {
        waiting_time: newWaitingTime,  // Update the waiting time field
      },
    };

    // Update the item in the database
    await paymentCollection.updateOne(query, updatedDoc);

    res.send({ result: true });  // Send success response
  } else {
    res.send({ result: false });  // Send failure response if item not found
  }
});

app.get("/waiter", async (req, res) => {
  try {
    const query = {

      payment_status: true,
    };

    const result = await paymentCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).send({ error: "Failed to fetch payments" });
  }
});


 //admin check waiter food completed
 

// Get all kitchen orders
app.get("/kitchenOrders", async (req, res) => {
  try {
    const kitchenOrders = await kitchenOrdersCollection.find().toArray();
    res.status(200).json(kitchenOrders); // Returns all kitchen orders
  } catch (error) {
    console.error("❌ Error fetching kitchen orders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    //menu related apis
    app.get("/menu", async (req, res) => {
      const { date } = req.query;
      let filter = {};

      if (date) {
        filter.date = date;
      }

      try {
        const result = await menuCollection.find(filter).toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "An error occurred while fetching the menu." });
      }
    });

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });

    app.patch("/menu/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          date: data.date,
          recipe: item.recipe,
          image: item.image,
        },
      };
      const result = await menuCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });
    //reviews

    // POST API to add a review
    app.post("/reviews", async (req, res) => {
      const review = req.body; // The review data will come in the request body

      /// Ensure the review has necessary fields (this step is optional but good practice)
      if (!review.name || !review.details || !review.rating) {
        return res.status(400).send("Name, details, and rating are required.");
      }

      try {
        const result = await reviewCollection.insertOne(review); // Insert the review into the collection
        res.status(201).send(result); // Send the inserted review object back as response with a 201 status
      } catch (error) {
        console.error("Error inserting review:", error);
        res.status(500).send("Error while adding the review.");
      }
    });

    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });
    // carts collection

    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const query = { menuId: cartItem.menuId };
      const exist = await cartCollection.findOne(query);
      console.log(exist);
      if (!exist) {
        cartItem.quantity = 1;
        const result = await cartCollection.insertOne(cartItem);
        res.json({
          success: true,
        });
      } else {
        const updatedDoc = {
          $set: {
            quantity: exist.quantity + 1,
          },
        };
        const result = await cartCollection.updateOne(query, updatedDoc);
        res.json({
          success: true,
        });
      }
    });

    // Carts delete

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // Bkash payment system
    const SSLCommerzApiUrl =
      "https://sandbox.sslcommerz.com/gwprocess/v4/api.php";

    const sslcommerz = new SSLCommerzPayment(
      process.env.SSL_COMMERZ_STORE_ID,
      process.env.SSL_COMMERZ_STORE_PASSWORD,
      false
    ); // false for sandbox

    app.post("/sslcommerz/create-payment", async (req, res) => {
      const {
        total_amount,
        currency,
        tran_id,
        success_url,
        fail_url,
        cancel_url,
        cus_name,
        cus_email,
        cus_phone = +8801317896036,
        cart,
        waiting_time,
        status,
      } = req.body;

      const data = {
        waiting_time,
        status,
        store_id: store_id,
        store_passwd: store_passwd,
        total_amount: total_amount,
        currency: currency,
        tran_id: tran_id,
        success_url: `http://localhost:5000/payment-success/${tran_id}?success_url=${success_url}`,
        fail_url: fail_url,
        cancel_url: cancel_url,
        ipn_url: "http://localhost:5000/ipn",
        shipping_method: "Courier",
        product_name: "Computer.",
        product_category: "Electronic",
        product_profile: "general",
        cus_name: cus_name,
        cus_email: cus_email,
        cus_add1: "Dhaka",
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: cus_phone,
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };

      try {
        const response = await axios({
          method: "POST",
          url: "https://sandbox.sslcommerz.com/gwprocess/v4/api.php",
          data: data,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });

        // Save the order with payment status false initially
        const finalOrder = {
          cus_email,
          cus_phone,
          tran_id,
          total_amount,
          currency,
          cart,
          waiting_time,
          status,
          payment_date: new Date().toISOString(),
          payment_status: false,
        };
        paymentCollection.insertOne(finalOrder);

        // Send the URL for SSLCommerz gateway
        res.send({
          url: response.data.GatewayPageURL,
        });
      } catch (error) {
        console.log(error);
        res.status(500).json(error);
      }
    });

    app.post("/payment-success/:tran_id", async (req, res) => {
      const { tran_id } = req.params;
      const { success_url } = req.query;

      // Update the payment status
      const result = await paymentCollection.updateOne(
        { tran_id: tran_id },
        {
          $set: {
            payment_status: true,
          },
        }
      );

      if (result.modifiedCount) {
        // Process the cart if necessary and delete the items or update cart status
        try {
          // Handle cart processing here (e.g., delete from cart collection)
          const order = await paymentCollection.findOne({ tran_id });
          await cartCollection.deleteMany({
            _id: { $in: order.cart.map((item) => new ObjectId(item._id)) },
          });

          res.redirect(success_url); // Redirect to success URL
        } catch (error) {
          console.log("Error processing cart:", error);
          res.status(500).json({ error: "Failed to process cart items" });
        }
      } else {
        res.status(400).json({ error: "Payment update failed" });
      }
    });

    app.get("/payments/:user_email", async (req, res) => {
      try {
        const { user_email } = req.params;
        const query = {
          cus_email: user_email,
          payment_status: true,
        };

        const result = await paymentCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ error: "Failed to fetch payments" });
      }
    });
    //report payment adminhome
    app.get("/payments", async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });
    // --------------------------------------
    //payment intent
    // app.post("/create-payment-intent", async (req, res) => {
    //   const { price } = req.body;
    //   const amount = parseInt(price * 100);
    //   console.log(amount, "amount inside the intent");
    //   const paymentIntent = await stripe.paymentIntents.create({
    //     amount: amount,
    //     currency: "usd",
    //     payment_method_types: ["card"],
    //   });

    //   res.send({
    //     clientSecret: paymentIntent.client_secret,
    //   });
    // });

    // app.get("/payments/:email", verifyToken, async (req, res) => {
    //   const query = { email: req.params.email };
    //   if (req.params.email !== req.decoded.email) {
    //     return res.status(403).send({ message: "forbidden access" });
    //   }
    //   const result = await paymentCollection.find(query).toArray();
    //   res.send(result);
    // });

    // app.post("/payments", async (req, res) => {
    //   const payment = req.body;
    //   const paymentResult = await paymentCollection.insertOne(payment);
    //   //deleted syste from the cart
    //   console.log("payment info", payment);
    //   const query = {
    //     _id: {
    //       $in: payment.cartIds.map((id) => new ObjectId(id)),
    //     },
    //   };
    //   const deleteResult = await cartCollection.deleteMany(query);
    //   res.send({ paymentResult, deleteResult });
    // });

    //stats or analytics
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      //revenu
      const result = await paymentCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenu: {
                $sum: "$price",
              },
            },
          },
        ])
        .toArray();

      const revenu = result.length > 0 ? result[0].totalRevenu : 0;

      res.send({
        users,
        menuItems,
        orders,
        revenu,
      });
    });
    //extra food
    // POST route to insert extraFoodItems
    app.post("/extra-food", async (req, res) => {
      try {
        const items = req.body;

        if (!Array.isArray(items)) {
          return res
            .status(400)
            .json({ error: "Expected an array of food items" });
        }

        const result = await charityCollection.insertMany(items);
        res.status(201).json({
          insertedCount: result.insertedCount,
          insertedIds: result.insertedIds,
        });
      } catch (error) {
        console.error("❌ Error inserting extra food items:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    // GET route to retrieve extraFoodItems
    app.get("/extra-food", async (req, res) => {
      try {
        const items = await charityCollection.find().toArray();
        res.status(200).json(items);
      } catch (error) {
        console.error("❌ Error fetching extra food items:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

   


    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("boss is sitting");
});

app.listen(port, () => {
  console.log(` Just cafe is sitting on port ${port} `);
});
