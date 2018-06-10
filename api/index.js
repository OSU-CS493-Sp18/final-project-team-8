const router = module.exports = require('express').Router();

router.use('/songs', require('./songs').router);
router.use('/reviews', require('./reviews').router);
router.use('/playlists', require('./playlists').router);
router.use('/users', require('./users').router);
