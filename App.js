const express = require("express");
const app = express();
const Listing = require("./models/listing");
const Review = require("./models/review");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const wrapAsync = require("./utils/wrapasync");
const ExpressErrors = require("./utils/ExpressErrors");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user");
const isLoggedIn = require("./middleware/middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // store uploaded files in uploads/

app.use(methodOverride("_method"));
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.set("views", path.join(__dirname, "views"));
app.engine("ejs", ejsMate);
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // serve uploaded files

// Session middleware
app.use(
  session({
    secret: "mysecret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    },
  })
);

// Flash middleware
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

// Flash + user locals middleware
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// MongoDB connection
const mongoose = require("mongoose");
main().catch((err) => console.log(err));
async function main() {
  await mongoose.connect("mongodb://127.0.0.1:27017/wanderlust");
}

// Home route
app.get("/", (req, res) => {
  res.send("yes we are ready");
});

// SIGNUP
app.get("/signup", (req, res) => {
  res.render("users/signup");
});
app.get("/listings", async (req, res) => {
    let query = {};

    const { maxPrice, location } = req.query; 

    if (maxPrice) {
        query.price = { $lte: parseInt(maxPrice) };
    }

    if (location) {
        query.location = { $regex: location, $options: 'i' };
    }

    const allListings = await Listing.find(query); 

    res.render("listings/index.ejs", { listing_data: allListings });
});
app.post("/signup", async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const newUser = new User({ username, email });
    const registeredUser = await User.register(newUser, password);
    req.login(registeredUser, (err) => {
      if (err) return next(err);
      req.flash("success", "Welcome to Wanderlust!");
      res.redirect("/listings");
    });
  } catch (e) {
    req.flash("error", e.message);
    res.redirect("/signup");
  }
});

// LOGIN
app.get("/login", (req, res) => {
  res.render("users/login");
});

app.post(
  "/login",
  passport.authenticate("local", { failureFlash: true, failureRedirect: "/login" }),
  (req, res) => {
    req.flash("success", "Welcome back!");
    res.redirect("/listings");
  }
);

// LOGOUT
app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "Logged you out!");
    res.redirect("/listings");
  });
});

// DELETE Listing
app.delete(
  "/listings/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    await Listing.findByIdAndDelete(req.params.id);
    req.flash("success", "Listing Deleted Successfully");
    res.redirect("/listings");
  })
);

// GET all listings
app.get(
  "/listings",
  wrapAsync(async (req, res) => {
    const listing_data = await Listing.find({});
    res.render("listings/index", { listing_data });
  })
);

// GET new listing form
app.get("/listings/new", isLoggedIn, (req, res) => {
  res.render("listings/new");
});

// ✅ CREATE new listing with image upload
app.post(
  "/listings",
  isLoggedIn,
  upload.single("image"), // multer middleware
  wrapAsync(async (req, res) => {
    const newListing = new Listing({
      title: req.body.title,
      description: req.body.description,
      price: Number(req.body.price),
      location: req.body.location,
      country: req.body.country,
      owner: req.user._id,
      image: {
        filename: req.file ? req.file.filename : "listingimage",
        url: req.file ? `/uploads/${req.file.filename}` : "https://share.google/images/DYSSlhUDv7rUdK8ai",
      },
    });

    await newListing.save();
    req.flash("success", "New Listing Created");
    res.redirect("/listings");
  })
);

// SHOW Listing
app.get(
  "/listings/:id",
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    const list = await Listing.findById(id)
      .populate({
        path: "reviews",
        populate: { path: "author" },
      })
      .populate("owner");

    if (!list) {
      req.flash("error", "Listing Not Found");
      return res.redirect("/listings");
    }

    res.render("listings/show", { list, currentUser: req.user });
  })
);

// GET edit form
app.get(
  "/listings/:id/edit",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const list = await Listing.findById(id);

    if (!list) {
      req.flash("error", "Listing Not Found");
      return res.redirect("/listings");
    }
    res.render("listings/edit", { list });
  })
);

// ✅ UPDATE Listing with optional new image upload
app.put(
  "/listings/:id",
  isLoggedIn,
  upload.single("image"), // multer middleware for updating image
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) {
      req.flash("error", "Listing Not Found");
      return res.redirect("/listings");
    }

    if (!listing.owner.equals(req.user._id)) {
      req.flash("error", "You do not have permission to edit this listing");
      return res.redirect(`/listings/${id}`);
    }

    listing.title = req.body.title;
    listing.description = req.body.description;
    listing.price = Number(req.body.price);
    listing.location = req.body.location;
    listing.country = req.body.country;

    if (req.file) {
      listing.image = {
        filename: req.file.filename,
        url: `/uploads/${req.file.filename}`,
      };
    }

    await listing.save();
    req.flash("success", "Listing Updated Successfully");
    res.redirect(`/listings/${id}`);
  })
);

// POST new review
app.post("/listings/:id/reviews", isLoggedIn, async (req, res) => {
  const { id } = req.params;
  const listing = await Listing.findById(id);
  const newReview = new Review(req.body.review);
  newReview.author = req.user._id;
  await newReview.save();

  listing.reviews.push(newReview);
  await listing.save();

  req.flash("success", "Review Added Successfully");
  res.redirect(`/listings/${id}`);
});

// DELETE Review
app.delete("/listings/:id/reviews/:reviewId", isLoggedIn, async (req, res) => {
  const { id, reviewId } = req.params;
  await Review.findByIdAndDelete(reviewId);
  await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });

  req.flash("success", "Review Deleted Successfully");
  res.redirect(`/listings/${id}`);
});

// 404 handler
app.all(/.*/, (req, res, next) => {
  next(new ExpressErrors("Page Not Found", 404));
});

// Error handler
app.use((err, req, res, next) => {
  const { statusCode = 500, message = "Something went wrong!" } = err;
  res.render("error.ejs", { err });
});

app.listen(8080, () => {
  console.log("SERVER IS READY");
});
