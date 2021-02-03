/* eslint  */

const GridRow = require('../shared/GridRow');
const FU = require('../shared/FormUtils');
const components = require('../shared/components');

class EmployeeConfigPage {
  constructor() {
    this.gridId = 'employee-config-grid';
  }

  async create(employee) {
    await FU.buttons.create();
    await FU.input('EmployeeModalCtrl.employee.label', employee.label);

    await FU.modal.submit();
    await components.notification.hasSuccess();
  }

  async errorOnCreateEmployeeConfig() {
    await FU.buttons.create();
    await FU.modal.submit();
    await FU.validation.error('EmployeeModalCtrl.employee.label');
    await FU.modal.cancel();
  }

  async update(label, updateEmployeeConfig) {
    const row = new GridRow(label);
    await row.dropdown().click();
    await row.edit().click();

    await FU.input('EmployeeModalCtrl.employee.label', updateEmployeeConfig.label);

    await FU.modal.submit();
    await components.notification.hasSuccess();
  }

  /**
   * simulate a click on the Configure link of a function
   */
  async setEmployeeConfig(label) {
    const row = new GridRow(label);
    await row.dropdown().click();
    await row.method('config').click();

    await components.bhCheckboxTree.toggleAllCheckboxes();

    await FU.modal.submit();
    await components.notification.hasSuccess();
  }

  /**
   * simulate a click on the Configure link of a function for Inset Employee
   */
  async unsetEmployeeConfig(label) {
    const row = new GridRow(label);
    await row.dropdown().click();
    await row.method('config').click();

    const isAllChecked = await components.bhCheckboxTree.isChecked();

    if (!isAllChecked) {
      // First click for select all
      await components.bhCheckboxTree.toggleAllCheckboxes();
    }

    // Second click for unselect all
    await components.bhCheckboxTree.toggleAllCheckboxes();

    await FU.modal.submit();
    await components.notification.hasSuccess();
  }

  async remove(label) {
    const row = new GridRow(label);
    await row.dropdown().click();
    await row.remove().click();

    await components.modalAction.confirm();
    await components.notification.hasSuccess();
  }
}

module.exports = EmployeeConfigPage;
