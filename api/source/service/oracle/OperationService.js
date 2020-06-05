'use strict';
const oracledb = require('oracledb')
const writer = require('../../utils/writer.js')
const dbUtils = require('./utils')


/**
 * Return version information
 *
 * returns ApiVersion
 **/
exports.getVersion = async function(userObject) {
  try {
    return (dbUtils.version)
  }
  catch(err) {
    throw ( writer.respondWithCode ( 500, {message: err.message,stack: err.stack} ) )
  }
}

exports.replaceAppData = async function (importOpts, appData, userObject ) {
  function dmlObjectFromAppData (appdata) {
    const {packages, departments, assets, users, reviews} = appdata
    let dml = {
      preload: [
        'ALTER TABLE REVIEW MODIFY CONSTRAINT PK_REVIEW DISABLE',
        'ALTER TABLE REVIEW MODIFY CONSTRAINT UK_REVIEW_2 DISABLE',
        'ALTER TABLE REVIEW_HISTORY MODIFY CONSTRAINT PK_RH DISABLE',
        `ALTER TABLE REVIEW DISABLE ALL TRIGGERS`,
        `ALTER TABLE ASSET DISABLE ALL TRIGGERS`
      ],
      postload: [
        `ALTER TABLE ASSET MODIFY ASSETID GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        `ALTER TABLE PACKAGE MODIFY PACKAGEID GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        `ALTER TABLE REVIEW MODIFY REVIEWID GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        `ALTER TABLE STATS_ASSET_STIG MODIFY ID GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        `ALTER TABLE STIG_ASSET_MAP MODIFY SAID GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        `ALTER TABLE USER_DATA MODIFY USERID GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        `ALTER TABLE USER_STIG_ASSET_MAP MODIFY ID GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE)`,
        `ALTER TABLE REVIEW ENABLE ALL TRIGGERS`,
        `ALTER TABLE ASSET ENABLE ALL TRIGGERS`,
        'ALTER TABLE REVIEW MODIFY CONSTRAINT PK_REVIEW ENABLE',
        'ALTER TABLE REVIEW MODIFY CONSTRAINT UK_REVIEW_2 ENABLE',
        'ALTER TABLE REVIEW_HISTORY MODIFY CONSTRAINT PK_RH ENABLE'
      ],
      department: {
        sqlDelete: `DELETE FROM department`,
        sqlInsert: `INSERT INTO department (deptId, name) VALUES (:deptId, :name)`,
        insertBinds: []
      },
      package: {
        sqlDelete: `DELETE FROM package`,
        sqlInsert: `INSERT INTO
        package (
          packageId,
          NAME, 
          EMASSID,
          REQRAR,
          POCNAME,
          POCEMAIL,
          POCPHONE 
        ) VALUES (
          :packageId, :name, :emassId, :reqRar, :pocName, :pocEmail, :pocPhone
        )`,
        insertBinds: []
      },
      userData: {
        sqlDelete: `DELETE FROM user_data`,
        sqlInsert: `INSERT INTO
        user_data (
          userId,
          username, 
          display,
          deptId,
          accessLevel,
          canAdmin
        ) VALUES (
          :userId, :username, :display, :deptId, :accessLevel, :canAdmin
        )`,
        insertBinds: []
      },
      asset: {
        sqlDelete: `DELETE FROM asset`,
        sqlInsert: `INSERT INTO asset (
          assetId,
          name,
          ip,
          deptId,
          packageId,
          nonnetwork
        ) VALUES (
          :assetId, :name, :ip, :deptId, :packageId, :nonnetwork
        )`,
        insertBinds: []
      },
      stigAssetMap: {
        sqlDelete: `DELETE FROM stig_asset_map`,
        sqlInsert: `INSERT INTO stig_asset_map (
          assetId,
          benchmarkId
        ) VALUES (
          :assetId, :benchmarkId
        )`,
        insertBinds: []
      },
      userStigAssetMap: {
        sqlDelete: `DELETE FROM user_stig_asset_map`,
        sqlInsert: `INSERT INTO user_stig_asset_map (
          userId,
          saId
        ) VALUES (
          :userId,
          (SELECT saId from stig_asset_map WHERE benchmarkId=:benchmarkId and assetId=:assetId)
        )`,
        insertBinds: []
      },
      reviewHistory: {
        sqlDelete: `TRUNCATE TABLE review_history`,
        sqlInsert: `INSERT INTO review_history (
          assetId,
          ruleId,
          activityType,
          columnName,
          oldValue,
          newValue,
          userId,
          ts
        ) VALUES (
          :assetId, :ruleId, :activityType, :columnName, :oldValue, :newValue, :userId, :ts
        )`,
        insertBinds: [],
        bindDefs: {
          assetId: {type: oracledb.DB_TYPE_NUMBER},
          ruleId: {type: oracledb.DB_TYPE_VARCHAR, maxSize: 45},
          activityType: {type: oracledb.DB_TYPE_VARCHAR, maxSize: 45},
          columnName: {type: oracledb.DB_TYPE_VARCHAR, maxSize: 45},
          oldValue: {type: oracledb.DB_TYPE_VARCHAR, maxSize: 32766},
          newValue: {type: oracledb.DB_TYPE_VARCHAR, maxSize: 32766},
          userId: {type: oracledb.DB_TYPE_NUMBER},
          ts: {type: oracledb.DB_TYPE_DATE}
        }
      },
      review: {
        sqlDelete: `TRUNCATE TABLE review`,
        sqlInsert: `INSERT INTO review (
          assetId,
          ruleId,
          resultId,
          resultComment,
          actionId,
          actionComment,
          userId,
          autoResult,
          ts,
          rejectText,
          rejectUserId,
          statusId
        ) VALUES (
          :assetId, :ruleId, :result, :resultComment, :action, :actionComment,
          :userId, :autoResult, :ts, :rejectText, :rejectUserId, :status
        )`,
        insertBinds: []
      }
    }

    // Process appdata object
    // DEPARTMENTS
    dml.department.insertBinds = departments

    // PACKAGES
    for (const p of packages) {
      p.reqRar = p.reqRar ? 1 : 0
    }
    dml.package.insertBinds = packages

    // USER_DATA
    for (const u of users) {
      u.canAdmin = u.canAdmin ? 1 : 0
    }
    dml.userData.insertBinds = users

    // ASSETS, ASSET_PACAKGE_MAP, STIG_ASSET_MAP, USER_STIG_ASSET_MAP
    for (const asset of assets) {
      let { stigReviewers, ...assetFields} = asset
      let assetId = assetFields.assetId
      assetFields.nonnetwork = assetFields.nonnetwork ? 1: 0
      dml.asset.insertBinds.push(assetFields)
      for (const sr of stigReviewers) {
        dml.stigAssetMap.insertBinds.push({
          assetId: assetId,
          benchmarkId: sr.benchmarkId
        })
        if (sr.userIds && sr.userIds.length > 0) {
          for (const userId of sr.userIds) {
            dml.userStigAssetMap.insertBinds.push({
              userId: userId,
              benchmarkId: sr.benchmarkId,
              assetId: assetId
            })
          }
        }
      }
    }

    // REVIEWS, REVIEWS_HISTORY
    for (const review of reviews) {
      review.autoResult = review.autoResult ? 1 : 0
      review.result = dbUtils.REVIEW_RESULT_API[review.result]
      review.action = review.action ? dbUtils.REVIEW_ACTION_API[review.action] : null
      review.status = review.status ? dbUtils.REVIEW_STATUS_API[review.status] : 0
      review.ts = new Date(review.ts)
      delete review.reviewId
      for (const h of review.history) {
        h.ts = new Date(h.ts)
        h.assetId = review.assetId
        h.ruleId = review.ruleId
        dml.reviewHistory.insertBinds.push(h)
      }
      delete review.history
    }
    dml.review.insertBinds = reviews

    return dml
  }

  let connection
  try {
    let result, hrstart, hrend, tableOrder, dml, stats = {}
    let totalstart = process.hrtime() 

    hrstart = process.hrtime() 
    dml = dmlObjectFromAppData(appData)
    hrend = process.hrtime(hrstart)
    stats.dmlObject = `Built in ${hrend[0]}s  ${hrend[1] / 1000000}ms`

    // Connect to Oracle, has transaction by default
    connection = await oracledb.getConnection()

    // Preload
    hrstart = process.hrtime() 
    for (const sql of dml.preload) {
      console.log(sql)
      result = await connection.execute(sql)
    }
    hrend = process.hrtime(hrstart)
    stats.preload = `${result.rowsAffected} in ${hrend[0]}s  ${hrend[1] / 1000000}ms`

    // Deletes
    tableOrder = [
      'reviewHistory',
      'review',
      'userStigAssetMap',
      'stigAssetMap',
      'package',
      'asset',
      'userData',
      'department'
    ]
    for (const table of tableOrder) {
      hrstart = process.hrtime() 
      result = await connection.execute(dml[table].sqlDelete)
      hrend = process.hrtime(hrstart)
      stats[table] = {}
      stats[table].delete = `${result.rowsAffected} in ${hrend[0]}s  ${hrend[1] / 1000000}ms`
    }

    // Inserts
    tableOrder = [
      'package',
      'department',
      'userData',
      'asset',
      'stigAssetMap',
      'userStigAssetMap',
      'review',
      'reviewHistory'
    ]
    for (const table of tableOrder) {
      if (dml[table].insertBinds.length > 0) {
        hrstart = process.hrtime() 
        result = await connection.executeMany(dml[table].sqlInsert, dml[table].insertBinds)
        hrend = process.hrtime(hrstart)
        stats[table].insert = `${result.rowsAffected} in ${hrend[0]}s  ${hrend[1] / 1000000}ms`
      }
    }

    // Commit
    hrstart = process.hrtime() 
    connection.commit()
    hrend = process.hrtime(hrstart)
    stats.commit = `${result.rowsAffected} in ${hrend[0]}s  ${hrend[1] / 1000000}ms`

    // Postload
    hrstart = process.hrtime() 
    for (const sql of dml.postload) {
      result = await connection.execute(sql)
    }
    hrend = process.hrtime(hrstart)
    stats.postload = `${result.rowsAffected} in ${hrend[0]}s  ${hrend[1] / 1000000}ms`

    // Total time calculation
    hrend = process.hrtime(totalstart)
    stats.total = `TOTAL in ${hrend[0]}s  ${hrend[1] / 1000000}ms`

    return (stats)
  }
  catch (err) {
    if (typeof connection !== 'undefined') {
      await connection.rollback()
    }
    throw err
  }
  finally {
    if (typeof connection !== 'undefined') {
      await connection.close()
    }
  }
}
