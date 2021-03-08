/*
  Copyright 2016 Google, Inc.

  Licensed to the Apache Software Foundation (ASF) under one or more contributor
  license agreements. See the NOTICE file distributed with this work for
  additional information regarding copyright ownership. The ASF licenses this
  file to you under the Apache License, Version 2.0 (the "License"); you may not
  use this file except in compliance with the License. You may obtain a copy of
  the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
  WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
  License for the specific language governing permissions and limitations under
  the License.
*/

'use strict';

var express = require('express');
var router = express.Router();
var models = require('./models');
var Sequelize = require('sequelize');

router.get('/', function(req, res, next) {
  var options = {
    order: [['createdAt', 'DESC']],
    raw: true
  };
  Sequelize.Promise.all([
    models.Order.findAll(options),
    models.Spreadsheet.findAll(options)
  ]).then(function(results) {
    res.render('index', {
      orders: results[0],
      spreadsheets: results[1]
    });
  }, function(err) {
    next(err);
  });
});

router.get('/create', function(req, res, next) {
  res.render('upsert');
});

router.get('/edit/:id', function(req, res, next) {
  models.Order.findByPk(req.params.id).then(function(order) {
    if (order) {
      res.render('upsert', {
        order: order.toJSON()
      });
    } else {
      next(new Error('Order not found: ' + req.params.id));
    }
  });
});

router.get('/delete/:id', function(req, res, next) {
  models.Order.findByPk(req.params.id)
    .then(function(order) {
      if (!order) {
        throw new Error('Order not found: ' + req.params.id);
      }
      return order.destroy();
    })
    .then(function() {
      res.redirect('/');
    }, function(err) {
      next(err);
    });
});

router.post('/upsert', function(req, res, next) {
  const boggieCostPerKm = 50;
  const wheelCostPerKm = 30;
  const distanceBetweenCities = {
      'del-mum':  1412, 
      'del-che':  2192,
      'mum-che':  1335
  }

  const departureDate = new Date(req.body.departureDate);
  const arrivalDate = new Date(req.body.arrivalDate);

  const sourceCitySlug = req.body.sourceCity.substring(0,3);
  const destinationCitySlug = req.body.destinationCity.substring(0,3);

  let distance = 0;
  
  if(distanceBetweenCities[`${sourceCitySlug}-${destinationCitySlug}`]){
      distance = distanceBetweenCities[`${sourceCitySlug}-${destinationCitySlug}`];
  } else if(distanceBetweenCities[`${destinationCitySlug}-${sourceCitySlug}`]) {
      distance = distanceBetweenCities[`${destinationCitySlug}-${sourceCitySlug}`];
  }
  
  const noOfDays = parseInt((arrivalDate - departureDate) / (24 * 3600 * 1000));
  let totalCost = 0;
  if (noOfDays) {
      const deduction = ( noOfDays > 6 && distance > 0 ) ? (noOfDays - 6) * 1000 : 0;
      
      totalCost = req.body.boggieNumber * distance * boggieCostPerKm + req.body.wheelsCount * distance * wheelCostPerKm - deduction;
  }

  req.body['totalDays'] = noOfDays;
  req.body['totalCost'] = totalCost;

  console.log('LOGGING INSIDE UPSERT', req.body);
  models.Order.upsert(req.body).then(function() {
    res.redirect('/');
  }, function(err) {
    next(err);
  });
});

// Route for creating spreadsheet.

var SheetsHelper = require('./sheets');

router.post('/spreadsheets', function(req, res, next) {
  var auth = req.get('Authorization');
  if (!auth) {
    return next(Error('Authorization required.'));
  }
  var accessToken = auth.split(' ')[1];
  var helper = new SheetsHelper(accessToken);
  var title = 'Orders (' + new Date().toLocaleTimeString() + ')';
  helper.createSpreadsheet(title, function(err, spreadsheet) {
    if (err) {
      return next(err);
    }
    var model = {
      id: spreadsheet.spreadsheetId,
      sheetId: spreadsheet.sheets[0].properties.sheetId,
      name: spreadsheet.properties.title
    };
    models.Spreadsheet.create(model).then(function() {
      return res.json(model);
    });
  });
});

// Route for syncing spreadsheet.

router.post('/spreadsheets/:id/sync', function(req, res, next) {
  var auth = req.get('Authorization');
  if (!auth) {
    return next(Error('Authorization required.'));
  }
  var accessToken = auth.split(' ')[1];
  var helper = new SheetsHelper(accessToken);
  Sequelize.Promise.all([
    models.Spreadsheet.findByPk(req.params.id),
    models.Order.findAll()
  ]).then(function(results) {
    var spreadsheet = results[0];
    var orders = results[1];
    helper.sync(spreadsheet.id, spreadsheet.sheetId, orders, function(err) {
      if (err) {
        return next(err);
      }
      return res.json(orders.length);
    });
  });
});

module.exports = router;
