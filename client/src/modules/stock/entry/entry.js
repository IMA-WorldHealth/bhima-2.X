angular.module('bhima.controllers')
  .controller('StockEntryController', StockEntryController);

// dependencies injections
StockEntryController.$inject = [
  'DepotService', 'InventoryService', 'NotifyService', 'SessionService', 'util',
  'bhConstants', 'ReceiptModal', 'PurchaseOrderService', 'StockFormService',
  'StockService', 'StockModalService', 'uiGridConstants', 'Store', 'appcache',
  'uuid', '$translate',
];

/**
 * @class StockEntryController
 *
 * @description
 * This controller is responsible to handle stock entry module.
 */
function StockEntryController(
  Depots, Inventory, Notify, Session, util, bhConstants, ReceiptModal, Purchase,
  StockForm, Stock, StockModal, uiGridConstants, Store, AppCache, Uuid, $translate
) {
  var vm = this;

  vm.stockForm = new StockForm('StockEntry');
  vm.movement = {};

  // exposing some properties to the view
  vm.itemIncrement = 1;
  vm.enterprise = Session.enterprise;
  vm.maxLength = util.maxLength;
  vm.maxDate = new Date();
  vm.entryOption = false;

  // exposing some methods to the view
  vm.addItems = addItems;
  vm.removeItem = removeItem;
  vm.selectEntryType = selectEntryType;
  vm.setInitialized = setInitialized;
  vm.setLots = setLots;
  vm.submit = submit;
  vm.changeDepot = changeDepot;

  var inventoryStore = null;
  var cache = new AppCache('StockEntry');
  var mapEntry = {
    purchase: { find: findPurchase, submit: submitPurchase },
    donation: { find: handleDonationSelection, submit: submitDonation },
    integration: { find: handleIntegrationSelection, submit: submitIntegration },
    transfer_reception: { find: findTransfer, submit: submitTransferReception },
  };
  var gridOptions = {
    appScopeProvider: vm,
    enableSorting: false,
    enableColumnMenus: false,
    columnDefs: [
      {
        field: 'status',
        width: 25,
        displayName: '',
        cellTemplate: 'modules/stock/entry/templates/status.tmpl.html'
      },

      {
        field: 'code',
        width: 120,
        displayName: 'TABLE.COLUMNS.CODE',
        headerCellFilter: 'translate',
        cellTemplate: 'modules/stock/entry/templates/code.tmpl.html'
      },

      {
        field: 'description',
        displayName: 'TABLE.COLUMNS.DESCRIPTION',
        headerCellFilter: 'translate',
        cellTemplate: 'modules/stock/entry/templates/description.tmpl.html'
      },

      {
        field: 'lot',
        width: 150,
        displayName: 'TABLE.COLUMNS.LOT',
        headerCellFilter: 'translate',
        cellTemplate: 'modules/stock/entry/templates/lot.tmpl.html'
      },

      {
        field: 'quantity',
        width: 150,
        displayName: 'TABLE.COLUMNS.QUANTITY',
        headerCellFilter: 'translate',
        cellTemplate: 'modules/stock/entry/templates/quantity.tmpl.html',
        aggregationType: uiGridConstants.aggregationTypes.sum
      },

      {
        field: 'actions',
        width: 25,
        cellTemplate: 'modules/stock/entry/templates/actions.tmpl.html'
      },
    ],
    data: vm.stockForm.store.data,
    fastWatch: true,
    flatEntityAccess: true,
  };

  // exposing the grid options to the view
  vm.gridOptions = gridOptions;

  function selectEntryType(entryType) {
    vm.movement.entry_type = entryType.label;
    mapEntry[entryType.label].find();

    vm.entryOption = entryType && entryType.label !== 'purchase';
  }

  // set initialized to true on the passed item
  function setInitialized(item) {
    item._initialised = true;
  }

  function addItems(n) {
    vm.stockForm.addItems(n);
    hasValidInput();
  }

  function removeItem(item) {
    vm.stockForm.removeItem(item.index);
    hasValidInput();
  }

  function setupStock() {
    vm.stockForm.setup();
    vm.stockForm.store.clear();
  }

  /**
   * The first function to ba called, it init : 
   * - A list of inventories
   * - An object dor a movement
   * - A depot from the cache or give possiblity of choosing one if not set
   */
  function startup() {
    // init a movement object
    vm.movement = {
      date: new Date(),
      entity: {},
    };

    // loading all purchasable inventories
    loadInventories();

    // fetch the depot from cash and init it
    vm.depot = cache.depot;

    // make sure that the depot is loaded if it doesn't exist at startup.
    if (vm.depot) {
      setupStock();
    } else {
      changeDepot()
        .then(setupStock);
    }
  }

  function loadInventories() {
    // by definition, a item is consumable if it is purchasable because it can finish or be full used (amorti)
    // an aspirin or a pen are both consumable because they can be purchased
    // we will load only purchasable items

    Inventory.read(null, { consumable: 1 })
      .then(function (inventories) {
        vm.inventories = inventories;
        inventoryStore = new Store({ identifier: 'uuid', data: inventories });
      })
      .catch(Notify.handleError);
  }

  // ============================ Modals ================================
  // find purchase
  function findPurchase() {
    initSelectedEntity('Stock Entry Purchase');

    StockModal.openFindPurchase()
      .then(function (purchase) {
        if (!purchase) { return; }
        vm.movement.entity = {
          uuid: purchase[0].uuid,
          type: 'purchase',
          instance: purchase[0], // just to get common information in every purchase
        };

        setSelectedEntity(vm.movement.entity.instance);
        populate(purchase);
      })
      .catch(Notify.handleError);
  }

  // find transfer
  function findTransfer() {
    initSelectedEntity();

    StockModal.openFindTansfer({ depot_uuid: vm.depot.uuid })
      .then(function (transfers) {
        if (!transfers) { return; }
        vm.movement.entity = {
          uuid: transfers[0].uuid,
          type: 'transfer_reception',
          instance: transfers[0],
        };

        vm.reference = transfers[0].documentReference;
        vm.movement.description = $translate.instant('STOCK.RECEPTION_DESCRIPTION');
        populate(transfers);
      })
      .catch(Notify.handleError);
  }

  function handleIntegrationSelection() {
    var description = $translate.instant('STOCK.RECEPTION_INTEGRATION');
    initSelectedEntity(description);
  }

  function handleDonationSelection() {
    var description = $translate.instant('STOCK.RECEPTION_DONATION');
    initSelectedEntity(description);
  }

  // fill the grid with the inventory contained in the purchase order
  function populate(items) {
    if (!items.length) { return; }

    // clear the store before adding new items
    vm.stockForm.store.clear();

    // adding items.length line in the stockForm store, which will be reflected to the grid
    vm.stockForm.addItems(items.length);

    vm.stockForm.store.data.forEach(function (item, index) {
      var inventory = inventoryStore.get(items[index].inventory_uuid);

      item.code = inventory.code;
      item.inventory_uuid = inventory.uuid;
      item.label = inventory.label;
      item.unit_cost = items[index].unit_price;
      item.quantity = items[index].quantity;
      item.cost = item.quantity * item.unit_cost;
      item.expiration_date = new Date();

      setInitialized(item);
    });
  }

  function initSelectedEntity(description) {
    vm.displayName = '';
    vm.reference = '';
    vm.movement.description = description;
  }

  function setSelectedEntity(entity) {
    var uniformEntity = Stock.uniformSelectedEntity(entity);
    vm.reference = uniformEntity.reference;
    vm.displayName = uniformEntity.displayName;
  }

  function setLots(stockLine) {
    StockModal.openDefineLots({
      stockLine: stockLine,
      entry_type: vm.movement.entry_type,
    })
      .then(function (res) {
        if (!row) { return; }
        stockLine.lots = res.lots;
        stockLine.givenQuantity = row.quantity;
        // vm.hasValidInput = hasValidInput();
      })
      .catch(Notify.handleError);
  }

  // validation
  // function hasValidInput() {
  //   return vm.stockForm.store.data.every(function (line) {
  //     return line.lots.length > 0;
  //   });
  // }

  function submit(form) {
    if (form.$invalid) { return; }
    mapEntry[vm.movement.entry_type].submit();
  }

  // submit purchase
  function submitPurchase() {
    var movement = {
      depot_uuid: vm.depot.uuid,
      entity_uuid: vm.movement.entity.uuid,
      date: vm.movement.date,
      description: vm.movement.description,
      flux_id: bhConstants.flux.FROM_PURCHASE,
      user_id: Session.user.id,
    };

    movement.lots = processLotsFromStore(vm.stockForm.store.data, vm.movement.entity.uuid);

    Stock.stocks.create(movement)
      .then(function (document) {
        vm.document = document;
        return Purchase.stockStatus(vm.movement.entity.uuid);
      })
      .then(function () {
        vm.stockForm.store.clear();
        vm.movement = {};
        ReceiptModal.stockEntryPurchaseReceipt(vm.document.uuid, bhConstants.flux.FROM_PURCHASE);
      })
      .catch(Notify.handleError);
  }

  /**
   * @function processLotsFromStore
   *
   * @description
   * This function loops through the store's contents mapping them into a flat array
   * of lots.
   *
   * @returns {Array} - lots in an array.
   */
  function processLotsFromStore(data, uuid) {
    return data.reduce(function (current, previous) {
      return previous.lots.map(function (lot) {
        return {
          label: lot.lot,
          initial_quantity: lot.quantity,
          quantity: lot.quantity,
          unit_cost: previous.unit_cost,
          expiration_date: lot.expiration_date,
          inventory_uuid: previous.inventory.uuid,
          origin_uuid: uuid,
        };
      }).concat(current);
    }, []);
  }

  // submit integration
  function submitIntegration() {
    var movement = {
      depot_uuid: vm.depot.uuid,
      entity_uuid: null,
      date: vm.movement.date,
      description: vm.movement.description,
      flux_id: bhConstants.flux.FROM_INTEGRATION,
      user_id: Session.user.id,
    };

    var entry = {
      lots: processLotsFromStore(vm.stockForm.store.data, movement.entity_uuid),
      movement: movement
    }

    Stock.integration.create(entry)
      .then(function (document) {
        vm.stockForm.store.clear();
        vm.movement = {};
        ReceiptModal.stockEntryIntegrationReceipt(document.uuid, bhConstants.flux.FROM_INTEGRATION);
      })
      .catch(Notify.handleError);
  }

  // submit donation
  function submitDonation() {
    var movement = {
      depot_uuid: vm.depot.uuid,
      entity_uuid: null,
      date: vm.movement.date,
      description: vm.movement.description,
      flux_id: bhConstants.flux.FROM_DONATION,
      user_id: Session.user.id,
    };

    /*
      the origin_uuid of lots is set on the client
      because donation table depends on donor, and donor management
      is not yet implemented in the application

      TODO: add a donor management module
    */
    movement.lots = processLotsFromStore(vm.stockForm.store.data, Uuid());

    return Stock.stocks.create(movement)
      .then(function (document) {
        vm.stockForm.store.clear();
        vm.movement = {};
        ReceiptModal.stockEntryDonationReceipt(document.uuid, bhConstants.flux.FROM_DONATION);
      })
      .catch(Notify.handleError);
  }

  // submit transfer reception
  function submitTransferReception() {
    var movement = {
      from_depot: vm.movement.entity.instance.depot_uuid,
      to_depot: vm.depot.uuid,
      document_uuid: vm.movement.entity.instance.document_uuid,
      date: vm.movement.date,
      description: vm.movement.entity.instance.description,
      isExit: false,
      user_id: Session.user.id,
    };

    var lots = vm.stockForm.store.data.map(function (row) {
      return {
        uuid: row.lot_uuid,
        quantity: row.lots[0].quantity,
        unit_cost: row.unit_cost,
      };
    });

    movement.lots = lots;

    return Stock.movements.create(movement)
      .then(function (document) {
        vm.stockForm.store.clear();
        vm.movement = {};
        ReceiptModal.stockEntryDepotReceipt(document.uuid, true);
      })
      .catch(Notify.handleError);
  }

  function changeDepot() {
    return Depots.openSelectionModal(vm.depot)
      .then(function (depot) {
        vm.depot = depot;
        cache.depot = vm.depot;
      });
  }

  startup();
}
