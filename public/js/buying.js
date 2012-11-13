// ERPNext - web based ERP (http://erpnext.com)
// Copyright (C) 2012 Web Notes Technologies Pvt Ltd
// 
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

wn.require("app/js/taxes_and_totals.js")
wn.provide("erpnext");

erpnext.Buying = erpnext.TaxesAndTotals.extend({
	toggle_fields: function() {
		this.frm.toggle_display("contact_section", this.frm.doc.supplier);
	},
	
	// item_code: function(doc, cdt, cdn) {
	// 		var me = this;
	// 		var item = locals[cdt][cdn];
	// 		if(item.item_code) {
	// 			wn.call({
	// 				doc: this.frm.doc,
	// 				method: "get_item_details",
	// 				args: {
	// 					item_code: item.item_code,
	// 					warehouse: item.warehouse,
	// 				},
	// 				callback: function(r) {
	// 					// update item doc
	// 					$.extend(locals[cdt][cdn], r.message);
	// 					refresh_field(me.item_table_field);
	// 				}
	// 			})
	// 		}
	// 	},
	
	warehouse: function(doc, cdt, cdn) {
		var me = this;
		var item = locals[cdt][cdn];
		if(item.item_code && item.warehouse) {
			wn.call({
				method: "stock.utils.get_projected_qty",
				args: {item_code: item.item_code, warehouse: item.warehouse},
				callback: function(r) {
					// TODO: how to refresh only a single grid cell
					item.projected_qty = r.message.projected_qty;
					refresh_field(me.item_table_field);
				}
			});
		}
	},
	
	uom: function(doc, cdt, cdn) {
		// QUESTION if there is an existing value, won't this overwrite them?
		var me = this;
		var item = locals[cdt][cdn];
		if(item.item_code && item.uom) {
			// update item doc with conversion factor, qty and rate
			wn.call({
				doc: this.frm.doc,
				method: "get_uom_details",
				args: {
					item_code: item.item_code,
					uom: item.uom,
					stock_qty: item.stock_qty,
					// qty: item.qty,
					exchange_rate: me.frm.doc.exchange_rate,
					doc_name: me.frm.doc.name,
				},
				callback: function(r) {
					$.extend(locals[cdt][cdn], r.message);
					refresh_field(me.item_table_field);

					// calculate
					// me.calc_amount();
				}
			});
		}
	},
	
	supplier: function() {
		var me = this;
		
		if(this.frm.doc.supplier) {
			wn.call({
				doc: this.frm.doc,
				method: "get_supplier_details",
				args: { supplier: me.frm.doc.supplier },
				callback: function(r) {
					me.frm.refresh();
				}
			});
		}
	},
	
	supplier_address: function() {
		if(this.frm.doc.supplier_address) {
			args = {"name": this.frm.doc.supplier_address};
			this.get_address(args);
		}
	},
	
	contact_person: function() {
		if(this.frm.doc.contact_person) {
			this.get_contact();
		}
	},
	
	is_stopped: function() {
		if(this.frm.doc.docstatus != 1) {
			var msg = repl("%(doctype)s must be submitted to stop/resume it",
				this.frm.doc);
			msgprint(msg);
			throw msg;
		}
	},
	
	set_schedule_date: function(item_table_field) {
		// if children, then set schedule date based on lead time days
		if(wn.model.has_children(this.frm.doc.doctype, this.frm.doc.name,
				item_table_field)) {
			wn.call({
				doc: this.frm.doc,
				method: "set_schedule_date",
				args: { item_table_field: item_table_field },
				callback: function(r) {
					refresh_field(item_table_field);
				}
			})	
		}
	},
	
	setup_get_query: function() {
		this._super();
		
		var me = this;
		var item_grid = this.frm.fields_dict[this.item_table_field].grid;
		
		// item_code
		item_grid.get_field("item_code").get_query = function() {
			if(me.frm.doc.is_subcontracted == "Yes") {
				var condition = "ifnull(is_subcontracted_item, 'No')='Yes'"
			} else {
				var condition = "ifnull(is_purchase_item, 'No')='Yes'"
			}
			var query = "select name, description from `tabItem` \
				where " + condition + " \
				and (ifnull(end_of_life, '')='' or end_of_life='0000-00-00' \
				or end_of_life > now()) and docstatus!=2 \
				and %(key)s like \"%s\" limit 50";
			
			return query;
		};
		
		// project
		// TODO: should be filtered by customer or supplier!
		if(item_grid.get_field("project_name")) {
			item_grid.get_field("project_name").get_query = function() {
				return "select name from `tabProject` \
					where status not in ('Completed', 'Cancelled') \
					and %(key)s like \"%s\" order by name asc limit 50";
			};
		}
		
		// supplier address
		if(this.frm.fields_dict.supplier_address) {
			this.frm.fields_dict.supplier_address.get_query = function() {
				return repl("select name, address_line1, city from `tabAddress` \
					where supplier = \"%(supplier)s\" and docstatus < 2 \
					and %(key)s like \"%s\" order by name asc limit 50", {
						supplier: me.frm.doc.supplier,
					});
			}
			this.frm.fields_dict.supplier_address.on_new = function(name) {
				me.set_dialog_defaults("Address", name);
			}
		}
		
		
		// contact person
		if(this.frm.fields_dict.contact_person) {
			this.frm.fields_dict.contact_person.get_query = function() {
				return repl("select name, concat(first_name, ' ', ifnull(last_name, '')) \
					as fullname, department, designation from tabContact \
					where supplier = \"%(supplier)s\" and docstatus < 2 \
					and %(key)s like \"%s\" order by name asc limit 50", {
						supplier: me.frm.doc.supplier,
					});
			}
			this.frm.fields_dict.contact_person.on_new = function(name) {
				me.set_dialog_defaults("Contact", name);
			}
		}
	},
	
	set_dialog_defaults: function(doctype, name) {
		var doc = locals[doctype][name];
		doc.supplier = me.frm.doc.supplier;
		doc.supplier_name = me.frm.doc.supplier_name;
	},
});