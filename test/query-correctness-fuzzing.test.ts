import {
    createRxDatabase,
    randomCouchString,
    overwritable,
    requestIdlePromise,
    RxJsonSchema,
    fillWithDefaultSettings,
    now,
    createRevision,
    prepareQuery,
    ensureNotFalsy
} from '../plugins/core/index.mjs';
import * as assert from 'assert';
import * as schemas from './helper/schemas.ts';
import * as schemaObjects from './helper/schema-objects.ts';
import config from './unit/config.ts';
import { randomBoolean, randomNumber, wait } from 'async-test-util';
import { randomStringWithSpecialChars } from './helper/schema-objects.ts';
import {
    random,
    randomOfArray
} from 'event-reduce-js';
import {
    Human,
    randomHuman,
    randomQuery,
    getRandomChangeEvents,
    mingoCollectionCreator,
    applyChangeEvent
} from 'event-reduce-js/truth-table-generator';

/**
 * Creates random writes, indexes and querys and tests if the results are correct.
 */
describe('query-correctness-fuzzing.test.ts', () => {
    it('init storage', async () => {
        if (config.storage.init) {
            await config.storage.init();
        }
    });
    it('run tests', async function () {
        this.timeout(1000 * 1000000);

        const eventsAmount = 30;
        const queriesAmount = 30;


        while (true) {
            console.log('-----------');
            const indexes = [
                ['_id'],
                ['name', 'gender', 'age'],
                ['gender', 'age', 'name'],
                ['age', 'name', 'gender'],
                ['gender', 'age'],
                ['name', 'gender']
            ] as const;
            const sorts = [
                [{ '_id': 'asc' }],
                [{ 'name': 'asc' }, { 'gender': 'asc' }, { '_id': 'asc' }],
                [{ 'gender': 'asc' }, { 'age': 'asc' }, { '_id': 'asc' }],
                [{ 'age': 'asc' }, { 'name': 'asc' }, { '_id': 'asc' }],
            ];
            const schemaPlain: RxJsonSchema<Human> = {
                primaryKey: '_id',
                type: 'object',
                version: 0,
                properties: {
                    _id: {
                        type: 'string',
                        maxLength: 20
                    },
                    name: {
                        type: 'string',
                        maxLength: 20
                    },
                    gender: {
                        type: 'string',
                        enum: ['f', 'm', 'x'],
                        maxLength: 1
                    },
                    age: {
                        type: 'number',
                        minimum: 0,
                        maximum: 100,
                        multipleOf: 1
                    }
                },
                indexes
            };
            const schema = fillWithDefaultSettings(schemaPlain);
            const storageInstance = await config.storage.getStorage().createStorageInstance({
                collectionName: randomCouchString(10),
                databaseName: randomCouchString(10),
                databaseInstanceToken: randomCouchString(10),
                multiInstance: false,
                devMode: false,
                options: {},
                schema
            });
            const collection = mingoCollectionCreator();
            const procedure = getRandomChangeEvents(eventsAmount);

            for (const changeEvent of procedure) {
                applyChangeEvent(
                    collection,
                    changeEvent
                );
                console.log('...........');
                console.dir(changeEvent);
                const docs = await storageInstance.findDocumentsById([changeEvent.id], true);
                console.dir(docs);
                const previous = docs[0];
                const nextRev = createRevision(randomCouchString(10), previous);

                if (changeEvent.operation === 'DELETE') {
                    const writeResult = await storageInstance.bulkWrite([{
                        previous: previous,
                        document: Object.assign({}, changeEvent.previous, {
                            _deleted: true,
                            _rev: nextRev,
                            _meta: {
                                lwt: now()
                            }
                        })
                    }], 'randomevent-delete');
                    assert.deepStrictEqual(writeResult.error, []);
                } else {
                    const writeResult = await storageInstance.bulkWrite([{
                        previous: previous,
                        document: Object.assign({}, changeEvent.doc, {
                            _deleted: false,
                            _rev: nextRev,
                            _meta: {
                                lwt: now()
                            }
                        })
                    }], 'randomevent');
                    assert.deepStrictEqual(writeResult.error, []);
                }
            }

            // ensure all docs are equal
            console.log('EEEEEEEEEEEEEEEEEEEEEEEEEEEEE');
            const allStorage = await storageInstance.query(prepareQuery(schema, { selector: { _deleted: { $eq: false } }, skip: 0, sort: [{ _id: 'asc' }] }));
            const allCorrect = collection.query({ selector: {}, sort: ['_id'] });
            console.dir(allStorage);
            console.dir(allCorrect);
            allCorrect.forEach((d, idx) => {
                const correctDoc = allStorage.documents[idx];
                assert.strictEqual(d._id, correctDoc._id);
            });


            let queryC = 0;
            while (queryC < queriesAmount) {
                queryC++;
                console.log('__________________________');
                const query = randomQuery();
                const sort = randomOfArray(sorts);
                console.dir(query);
                const mingoSort = sort.map(sortPart => {
                    const dirPrefix = Object.values(sortPart)[0] === 'asc' ? '' : '-';
                    return dirPrefix + Object.keys(sortPart)[0];
                });
                query.sort = mingoSort;
                const correctResult = collection.query(query);
                query.sort = sort;
                query.selector._deleted = { $eq: false };
                // must have the same result for all indexes
                for (const index of ensureNotFalsy(schema.indexes)) {
                    query.index = index;
                    console.dir('DDDD');
                    const preparedQuery = prepareQuery(schema, query);
                    console.dir(preparedQuery);
                    const storageResult = await storageInstance.query(preparedQuery);
                    console.dir(correctResult);
                    console.dir(storageResult);

                    storageResult.documents.forEach((d, idx) => {
                        const correctDoc = correctResult[idx];
                        assert.strictEqual(d._id, correctDoc._id);
                    });

                }
            }





            await wait(100);
            await storageInstance.close();
        }



    });
});
