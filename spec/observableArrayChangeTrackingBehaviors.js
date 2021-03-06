describe('Observable Array change tracking', function() {

    it('Supplies changelists to subscribers', function() {
        var myArray = ko.observableArray(['Alpha', 'Beta', 'Gamma']),
            changelist;

        myArray.subscribe(function(changes) {
            changelist = changes;
        }, null, 'arrayChange');

        // Not going to test all possible types of mutation, because we know the diffing
        // logic is all in ko.utils.compareArrays, which is tested separately. Just
        // checking that a simple 'push' comes through OK.
        myArray.push('Delta');
        expect(changelist).toEqual([
            { status: 'added', value: 'Delta', index: 3 }
        ]);
    });

    it('Only computes diffs when there\'s at least one active arrayChange subscription', function() {
        captureCompareArraysCalls(function(callLog) {
            var myArray = ko.observableArray(['Alpha', 'Beta', 'Gamma']);

            // Nobody has yet subscribed for arrayChange notifications, so
            // array mutations don't involve computing diffs
            myArray(['Another']);
            expect(callLog.length).toBe(0);

            // When there's a subscriber, it does compute diffs
            var subscription = myArray.subscribe(function() {}, null, 'arrayChange');
            myArray(['Changed']);
            expect(callLog.length).toBe(1);

            // If all the subscriptions are disposed, it stops computing diffs
            subscription.dispose();
            myArray(['Changed again']);
            expect(callLog.length).toBe(1); // Did not increment

            // ... but that doesn't stop someone else subscribing in the future,
            // then diffs are computed again
            myArray.subscribe(function() {}, null, 'arrayChange');
            myArray(['Changed once more']);
            expect(callLog.length).toBe(2);
        });
    });

    it('Reuses cached diff results', function() {
        captureCompareArraysCalls(function(callLog) {
            var myArray = ko.observableArray(['Alpha', 'Beta', 'Gamma']),
                changelist1,
                changelist2;

            myArray.subscribe(function(changes) { changelist1 = changes; }, null, 'arrayChange');
            myArray.subscribe(function(changes) { changelist2 = changes; }, null, 'arrayChange');
            myArray(['Gamma']);

            // See that, not only did it invoke compareArrays only once, but the
            // return values from getChanges are the same array instances
            expect(callLog.length).toBe(1);
            expect(changelist1).toEqual([
                { status: 'deleted', value: 'Alpha', index: 0 },
                { status: 'deleted', value: 'Beta', index: 1 }
            ]);
            expect(changelist2).toBe(changelist1);

            // Then when there's a further change, there's a further diff
            myArray(['Delta']);
            expect(callLog.length).toBe(2);
            expect(changelist1).toEqual([
                { status: 'deleted', value: 'Gamma', index: 0 },
                { status: 'added', value: 'Delta', index: 0 }
            ]);
            expect(changelist2).toBe(changelist1);
        });
    });

    it('Skips the diff algorithm when the array mutation is a known operation', function() {
        captureCompareArraysCalls(function(callLog) {
            var myArray = ko.observableArray(['Alpha', 'Beta', 'Gamma']),
                browserSupportsSpliceWithoutDeletionCount = [1, 2].splice(1).length === 1;

            // Push
            testKnownOperation(myArray, 'push', {
                args: ['Delta', 'Epsilon'],
                result: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'],
                changes: [
                    { status: 'added', value: 'Delta', index: 3 },
                    { status: 'added', value: 'Epsilon', index: 4 }
                ]
            });

            // Pop
            testKnownOperation(myArray, 'pop', {
                args: [],
                result: ['Alpha', 'Beta', 'Gamma', 'Delta'],
                changes: [
                    { status: 'deleted', value: 'Epsilon', index: 4 }
                ]
            });

            // Pop empty array
            testKnownOperation(ko.observableArray([]), 'pop', {
                args: [], result: [], changes: []
            });

            // Shift
            testKnownOperation(myArray, 'shift', {
                args: [],
                result: ['Beta', 'Gamma', 'Delta'],
                changes: [
                    { status: 'deleted', value: 'Alpha', index: 0 }
                ]
            });

            // Shift empty array
            testKnownOperation(ko.observableArray([]), 'shift', {
                args: [], result: [], changes: []
            });

            // Unshift
            testKnownOperation(myArray, 'unshift', {
                args: ['First', 'Second'],
                result: ['First', 'Second', 'Beta', 'Gamma', 'Delta'],
                changes: [
                    { status: 'added', value: 'First', index: 0 },
                    { status: 'added', value: 'Second', index: 1 }
                ]
            });

            // Splice
            testKnownOperation(myArray, 'splice', {
                args: [2, 3, 'Another', 'YetAnother'],
                result: ['First', 'Second', 'Another', 'YetAnother'],
                changes: [
                    { status: 'added', value: 'Another', index: 2 },
                    { status: 'deleted', value: 'Beta', index: 2 },
                    { status: 'added', value: 'YetAnother', index: 3 },
                    { status: 'deleted', value: 'Gamma', index: 3 },
                    { status: 'deleted', value: 'Delta', index: 4 }
                ]
            });

            // Splice - no 'deletion count' supplied (deletes everything after start index)
            if (browserSupportsSpliceWithoutDeletionCount) {
                testKnownOperation(myArray, 'splice', {
                    args: [2],
                    result: ['First', 'Second'],
                    changes: [
                        { status: 'deleted', value: 'Another', index: 2 },
                        { status: 'deleted', value: 'YetAnother', index: 3 }
                    ]
                });
            } else {
                // Browser doesn't support that underlying operation, so just set the state
                // to what it needs to be to run the remaining tests
                myArray(['First', 'Second']);
            }

            // Splice - deletion end index out of bounds
            testKnownOperation(myArray, 'splice', {
                args: [1, 50, 'X', 'Y'],
                result: ['First', 'X', 'Y'],
                changes: [
                    { status: 'added', value: 'X', index: 1 },
                    { status: 'deleted', value: 'Second', index: 1 },
                    { status: 'added', value: 'Y', index: 2 }
                ]
            });

            // Splice - deletion start index out of bounds
            testKnownOperation(myArray, 'splice', {
                args: [25, 3, 'New1', 'New2'],
                result: ['First', 'X', 'Y', 'New1', 'New2'],
                changes: [
                    { status: 'added', value: 'New1', index: 3 },
                    { status: 'added', value: 'New2', index: 4 }
                ]
            });

            // Splice - deletion start index negative (means 'from end of array')
            testKnownOperation(myArray, 'splice', {
                args: [-3, 2, 'Blah', 'Another'],
                result: ['First', 'X', 'Blah', 'Another', 'New2'],
                changes: [
                    { status: 'added', value: 'Blah', index: 2 },
                    { status: 'deleted', value: 'Y', index: 2 },
                    { status: 'added', value: 'Another', index: 3 },
                    { status: 'deleted', value: 'New1', index: 3 }
                ]
            });

            expect(callLog.length).toBe(0); // Never needed to run the diff algorithm
        });
    });

    it('Should support tracking of any observable using extender', function() {
        var myArray = ko.observable(['Alpha', 'Beta', 'Gamma']).extend({trackArrayChanges:true}),
            changelist;

        myArray.subscribe(function(changes) {
            changelist = changes;
        }, null, 'arrayChange');

        myArray(['Alpha', 'Beta', 'Gamma', 'Delta']);
        expect(changelist).toEqual([
            { status: 'added', value: 'Delta', index: 3 }
        ]);

        // Should treat null value as an empty array
        myArray(null);
        expect(changelist).toEqual([
            { status : 'deleted', value : 'Alpha', index : 0 },
            { status : 'deleted', value : 'Beta', index : 1 },
            { status : 'deleted', value : 'Gamma', index : 2 },
            { status : 'deleted', value : 'Delta', index : 3 }
        ]);

        // Check that extending the observable again doesn't break anything an only one diff is generated
        var changelist2, callCount = 0;
        myArray = myArray.extend({trackArrayChanges:true});

        myArray.subscribe(function(changes) {
            callCount++;
            changelist2 = changes;
        }, null, 'arrayChange');

        myArray(['Gamma']);
        expect(callCount).toEqual(1);
        expect(changelist2).toEqual([
            { status : 'added', value : 'Gamma', index : 0 }
        ]);
        expect(changelist2).toBe(changelist);
    });

    it('Should support tracking of a computed observable using extender', function() {
        var myArray = ko.observable(['Alpha', 'Beta', 'Gamma']),
            myComputed = ko.computed(function() {
                return myArray().slice(-2);
            }).extend({trackArrayChanges:true}),
            changelist;

        expect(myComputed()).toEqual(['Beta', 'Gamma']);

        myComputed.subscribe(function(changes) {
            changelist = changes;
        }, null, 'arrayChange');

        myArray(['Alpha', 'Beta', 'Gamma', 'Delta']);
        expect(myComputed()).toEqual(['Gamma', 'Delta']);
        expect(changelist).toEqual([
            { status : 'deleted', value : 'Beta', index : 0 },
            { status : 'added', value : 'Delta', index : 1 }
        ]);
    });

    function testKnownOperation(array, operationName, options) {
        var changeList,
            subscription = array.subscribe(function(changes) {
                expect(array()).toEqual(options.result);
                changeList = changes;
            }, null, 'arrayChange');
        array[operationName].apply(array, options.args);
        subscription.dispose();

        // The ordering of added/deleted items for replaced entries isn't defined, so
        // we'll sort by index and then status just so the tests can get consistent results
        changeList.sort(compareChangeListItems);
        expect(changeList).toEqual(options.changes);
    }

    function compareChangeListItems(a, b) {
        return (a.index - b.index) || a.status.localeCompare(b.status);
    }

    // There's no public API for intercepting ko.utils.compareArrays, so we'll have to
    // inspect the runtime to work out the private name(s) for it, and intercept them all.
    // Then undo it all afterwards.
    function captureCompareArraysCalls(callback) {
        var origCompareArrays = ko.utils.compareArrays,
            interceptedCompareArrays = function() {
                callLog.push(Array.prototype.slice.call(arguments, 0));
                return origCompareArrays.apply(this, arguments);
            },
            aliases = [],
            callLog = [];

        // Find and intercept all the aliases
        for (var key in ko.utils) {
            if (ko.utils[key] === origCompareArrays) {
                aliases.push(key);
                ko.utils[key] = interceptedCompareArrays;
            }
        }

        try {
            callback(callLog);
        } finally {
            // Undo the interceptors
            for (var i = 0; i < aliases.length; i++) {
                ko.utils[aliases[i]] = origCompareArrays;
            }
        }
    }
});
