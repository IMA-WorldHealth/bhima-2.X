/* global element, by */
const { expect } = require('chai');
const FU = require('../shared/FormUtils');
const helpers = require('../shared/helpers');
const components = require('../shared/components');

describe('Fiscal Year', () => {
  const path = '#!/fiscal';
  const pathNew = '#!/fiscal/create';

  before(() => helpers.navigate(path));

  const fiscalYear = {
    label    : 'A Special Fiscal Year',
    note     : 'Note for the new fiscal Year',
    previous : '2020',
  };

  it('blocks invalid form submission with relevant error classes', async () => {
    // switch to the create form
    await FU.buttons.create();

    // verify form has not been successfully submitted
    expect(await helpers.getCurrentPath()).to.equal(pathNew);

    // set invalid date range to test `number_of_months`
    await components.dateInterval.range('01/02/2016', '01/01/2016');

    await FU.buttons.submit();

    // the following fields should be required
    await FU.validation.error('FiscalManageCtrl.fiscal.label');
    await FU.validation.error('FiscalManageCtrl.fiscal.number_of_months');

    await components.notification.hasDanger();
  });

  it('creates a new fiscalYear', async () => {
    await FU.input('FiscalManageCtrl.fiscal.label', fiscalYear.label);

    // select the proper date
    await components.dateInterval.range('01/01/2022', '31/12/2022');
    await FU.select('FiscalManageCtrl.fiscal.previous_fiscal_year_id', fiscalYear.previous);
    await FU.input('FiscalManageCtrl.fiscal.note', fiscalYear.note);
    await FU.buttons.submit();

    await components.notification.hasSuccess();
  });

  it('edits a fiscal Year', async () => {
    const updateButton = element.all(by.css('[data-fiscal-entry]'));
    await updateButton.all(by.css('[data-method="update"]')).first().click();

    // modify the fiscal year label and note
    await FU.input('FiscalManageCtrl.fiscal.label', 'Test Fiscal Year 2017 (update)');
    await FU.input('FiscalManageCtrl.fiscal.note', 'Test 2017 [update]');

    await FU.buttons.submit();
    await components.notification.hasSuccess();
  });

  it('delete a fiscal Year', async () => {
    const deleteButton = element.all(by.css('[data-fiscal-entry]'));
    await deleteButton.all(by.css('[data-method="delete"]')).first().click();

    // click the alert asking for permission
    await components.modalAction.confirm();
    await components.notification.hasSuccess();
  });

  it('set the opening balance for the first fiscal year', async () => {
    // await helpers.navigate(path);

    await $('.pagination-last > a').click();

    // the last in the list is the oldest
    const updateButton = element.all(by.css('[data-fiscal-entry]'));
    await updateButton.all(by.css('[data-method="update"]')).last().click();

    // click on the opening balance button
    await element(by.css('[data-action="opening-balance"]')).click();

    // actions in the grid
    const account1 = 85;
    const account2 = 89;
    const account3 = 83;

    await element(by.css(`[data-debit-account="${account1}"]`)).clear().sendKeys(150);
    await element(by.css(`[data-debit-account="${account2}"]`)).clear().sendKeys(150);
    await element(by.css(`[data-credit-account="${account3}"]`)).clear().sendKeys(300);

    await FU.buttons.submit();
    await components.notification.hasSuccess();
  });

  it('forbid not balanced submission', async () => {
    await helpers.navigate(path);

    // jump to opening balance
    // await $('.pagination-last').click();

    // the last in the list is the oldest
    const updateButton = element.all(by.css('[data-fiscal-entry]'));
    await updateButton.all(by.css('[data-method="update"]')).last().click();

    // click on the opening balance button
    await element(by.css('[data-action="opening-balance"]')).click();

    // actions in the grid
    const account1 = 85;
    const account2 = 89;
    const account3 = 83;

    await element(by.css(`[data-debit-account="${account1}"]`)).clear().sendKeys(150);
    await element(by.css(`[data-debit-account="${account2}"]`)).clear().sendKeys(150);
    await element(by.css(`[data-credit-account="${account3}"]`)).clear().sendKeys(200);

    await FU.buttons.submit();
    await components.notification.hasDanger();
    expect(await element(by.css('[data-status="not-balanced"]')).isPresent()).to.equal(true);
  });

  it('closing a fiscal year in normal way', async () => {
    await helpers.navigate(path);

    // jump to opening balance
    // await $('.pagination-last').click();

    // the last in the list is the oldest
    const updateButton = element.all(by.css('[data-fiscal-entry]'));
    await updateButton.all(by.css('[data-method="update"]')).last().click();

    // this fix multiple element found take first
    const submitButton = element.all(by.css('[data-method="submit"]')).first();

    // click on the opening balance button
    await element(by.css('[data-action="closing-fiscal-year"]')).click();

    // inner variables
    const resultAccount = '13110001'; // 13110001 -Résusltat de l\'exercise

    // set the result account
    await components.accountSelect.set(resultAccount);

    // submit to next step
    await submitButton.click();

    // submit to confirm info
    await submitButton.click();

    // submit to confirm the action
    await submitButton.click();

    // check notification
    await components.notification.hasSuccess();
  });
});
