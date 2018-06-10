const router = module.exports = require('express').Router();

router.use('/songs', require('./songs').router);
router.use('/reviews', require('./reviews').router);
router.use('/photos', require('./photos').router);
router.use('/usersB', require('./usersB').router);
router.use('/users', require('./users').router);
