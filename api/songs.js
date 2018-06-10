const router = require('express').Router();
const validation = require('../lib/validation');
const { getReviewsByBusinessID } = require('./reviews');
const { getPhotosByBusinessID } = require('./playlists');
const { addSongToUser, getUserByID } = require('./users');


/*
 * Schema describing required/optional fields of a business object.
 */
const songSchema = {
  ownerID: { required: true },
  name: { required: true },
  length: { required: true },
  artist: { required: true },
  album: { required: true },
  genre: { required: false }
};

/*
 * Executes a MySQL query to fetch the total number of businesses.  Returns
 * a Promise that resolves to this count.
 */
function getSongsCount(mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query('SELECT COUNT(*) AS count FROM songs', function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results[0].count);
      }
    });
  });
}

/*
 * Executes a MySQL query to return a single page of businesses.  Returns a
 * Promise that resolves to an array containing the fetched page of businesses.
 */
function getSongsPage(page, totalCount, mysqlPool) {
  return new Promise((resolve, reject) => {
    /*
     * Compute last page number and make sure page is within allowed bounds.
     * Compute offset into collection.
     */
    const numPerPage = 10;
    const lastPage = Math.max(Math.ceil(totalCount / numPerPage), 1);
    page = page < 1 ? 1 : page;
    page = page > lastPage ? lastPage : page;
    const offset = (page - 1) * numPerPage;

    mysqlPool.query(
      'SELECT * FROM songs ORDER BY id LIMIT ?,?',
      [ offset, numPerPage ],
      function (err, results) {
        if (err) {
          reject(err);
        } else {
          resolve({
            songs: results,
            pageNumber: page,
            totalPages: lastPage,
            pageSize: numPerPage,
            totalCount: totalCount
          });
        }
      }
    );
  });
}

/*
 * Route to return a paginated list of songs.
 */
router.get('/', function (req, res) {
  const mysqlPool = req.app.locals.mysqlPool;
  getSongsCount(mysqlPool)
    .then((count) => {
      return getSongsPage(parseInt(req.query.page) || 1, count, mysqlPool);
    })
    .then((songsPageInfo) => {
      /*
       * Generate HATEOAS links for surrounding pages and then send response.
       */
      songsPageInfo.links = {};
      let { links, pageNumber, totalPages } = songsPageInfo;
      if (pageNumber < totalPages) {
        links.nextPage = `/songs?page=${pageNumber + 1}`;
        links.lastPage = `/songs?page=${totalPages}`;
      }
      if (pageNumber > 1) {
        links.prevPage = `/songs?page=${pageNumber - 1}`;
        links.firstPage = '/songs?page=1';
      }
      res.status(200).json(songsPageInfo);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: "Error fetching songs list.  Please try again later."
      });
    });
});

/*
 * Executes a MySQL query to insert a new song into the database.  Returns
 * a Promise that resolves to the ID of the newly-created song entry.
 */
function insertNewSong(song, mysqlPool, mongoDB) {
  return new Promise((resolve, reject) => {
    song = validation.extractValidFields(song, songSchema);
    song.id = null;
    mysqlPool.query(
      'INSERT INTO songs SET ?',
      song,
      function (err, result) {
        if (err) {
          reject(err);
        } else {
          resolve(result.insertId);
        }
      }
    );
  }).then((id) => {
    return addSongToUser(id, song.ownerID, mongoDB);
  });
}

/*
 * Route to create a new song.
 */
router.post('/', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  const mongoDB = req.app.locals.mongoDB;
  if (validation.validateAgainstSchema(req.body, songSchema)) {
    getUserByID(req.body.ownerID, mongoDB)
      .then((user) => {
        if (user) {
          return insertNewSong(req.body, mysqlPool, mongoDB);
        } else {
          return Promise.reject(400);
        }
      })
      .then((id) => {
        res.status(201).json({
          id: id,
          links: {
            song: `/songs/${id}`
          }
        });
      })
      .catch((err) => {
        if (err === 400) {
          res.status(400).json({
            error: `Invalid owner ID: ${req.body.ownerID}.`
          });
        } else {
          res.status(500).json({
            error: "Error inserting song into DB.  Please try again later."
          });
        }
      });
  } else {
    res.status(400).json({
      error: "Request needs a valid JSON body."
    });
  }

});

/*
 * Executes a MySQL query to fetch information about a single specified
 * song based on its ID.  Returns a Promise that resolves to an object
 * containing information about the requested business.  If no business with
 * the specified ID exists, the returned Promise will resolve to null.
 */
function getBusinessByID(businessID, mysqlPool) {
  /*
   * Execute three sequential queries to get all of the info about the
   * specified business, including its reviews and photos.  If the original
   * request to fetch the business doesn't match a business, send null through
   * the promise chain.
   */
  let returnBusiness = {};
  return new Promise((resolve, reject) => {
    mysqlPool.query('SELECT * FROM businesses WHERE id = ?', [ businessID ], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results[0]);
      }
    });
  }).then((business) => {
    if (business) {
      returnBusiness = business;
      return getReviewsByBusinessID(businessID, mysqlPool);
    } else {
      return Promise.resolve(null);
    }
  }).then((reviews) => {
    if (reviews) {
      returnBusiness.reviews = reviews;
      return getPhotosByBusinessID(businessID, mysqlPool);
    } else {
      return Promise.resolve(null);
    }
  }).then((photos) => {
    if (photos) {
      returnBusiness.photos = photos;
      return Promise.resolve(returnBusiness);
    } else {
      return Promise.resolve(null);
    }
  })
}

/*
 * Route to fetch info about a specific business.
 */
router.get('/:businessID', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  const businessID = parseInt(req.params.businessID);
  getBusinessByID(businessID, mysqlPool)
    .then((business) => {
      if (business) {
        res.status(200).json(business);
      } else {
        next();
      }
    })
    .catch((err) => {
      res.status(500).json({
        error: "Unable to fetch business.  Please try again later."
      });
    });
});

/*
 * Executes a MySQL query to replace a specified business with new data.
 * Returns a Promise that resolves to true if the business specified by
 * `businessID` existed and was successfully updated or to false otherwise.
 */
function replaceBusinessByID(businessID, business, mysqlPool) {
  return new Promise((resolve, reject) => {
    business = validation.extractValidFields(business, businessSchema);
    mysqlPool.query('UPDATE businesses SET ? WHERE id = ?', [ business, businessID ], function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result.affectedRows > 0);
      }
    });
  });
}

/*
 * Route to replace data for a business.
 */
router.put('/:businessID', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  const businessID = parseInt(req.params.businessID);
  if (validation.validateAgainstSchema(req.body, businessSchema)) {
    replaceBusinessByID(businessID, req.body, mysqlPool)
      .then((updateSuccessful) => {
        if (updateSuccessful) {
          res.status(200).json({
            links: {
              business: `/businesses/${businessID}`
            }
          });
        } else {
          next();
        }
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({
          error: "Unable to update specified business.  Please try again later."
        });
      });
  } else {
    res.status(400).json({
      error: "Request body is not a valid business object"
    });
  }
});

/*
 * Executes a MySQL query to delete a business specified by its ID.  Returns
 * a Promise that resolves to true if the business specified by `businessID`
 * existed and was successfully deleted or to false otherwise.
 */
function deleteBusinessByID(businessID, mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query('DELETE FROM businesses WHERE id = ?', [ businessID ], function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result.affectedRows > 0);
      }
    });
  });

}

/*
 * Route to delete a business.
 */
router.delete('/:businessID', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  const businessID = parseInt(req.params.businessID);
  deleteBusinessByID(businessID, mysqlPool)
    .then((deleteSuccessful) => {
      if (deleteSuccessful) {
        res.status(204).end();
      } else {
        next();
      }
    })
    .catch((err) => {
      res.status(500).json({
        error: "Unable to delete business.  Please try again later."
      });
    });
});

/*
 * Executes a MySQL query to fetch all businesses owned by a specified user,
 * based on on the user's ID.  Returns a Promise that resolves to an array
 * containing the requested businesses.  This array could be empty if the
 * specified user does not own any businesses.  This function does not verify
 * that the specified user ID corresponds to a valid user.
 */
function getBusinessesByOwnerID(userID, mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query(
      'SELECT * FROM businesses WHERE ownerID = ?',
      [ userID ],
      function (err, results) {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      }
    );
  });
}

exports.router = router;
exports.getBusinessesByOwnerID = getBusinessesByOwnerID;
