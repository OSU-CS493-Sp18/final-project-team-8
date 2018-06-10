//use "yelp"

db.createUser({
  user: "rootx",
  pwd: "rootx",
  roles: [ { role: "readWrite", db: "yelp" } ]
});

db.users.insertOne({
  userID: "tom",
  name: "tom jerry",
  email: "tomjerry@gmail.com",
  businesses: []
});
