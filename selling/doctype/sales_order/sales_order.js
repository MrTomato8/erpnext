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


wn.require('public/app/js/selling.js');
wn.provide("erpnext.selling");

erpnext.selling.SalesOrder = erpnext.Selling.extend({
	onload: function() {
		this._super();
		// this.make_communication_body();
	},
	
	refresh: function() {
		this._super();
		this.add_buttons();
		this.toggle_fields();
		if (!doc.__islocal) this.render_communication_list();
	},
	
	add_buttons: function() {
		var me = this;
		if (this.frm.doc.docstatus == 1) {
			if(this.frm.doc.is_stopped == 1) {
				this.frm.add_custom_button("Resume Sales Order",
					function() { me.resume_transaction(this); }, "icon-play");
			} else {
				// delivery note
				if (this.frm.doc.per_delivered < 100 && this.frm.doc.order_type == 'Sales')
					this.frm.add_custom_button("Make Delivery Note", 
						function() { me.make_delivery_note(this);});
			
				// maintenance
				if (doc.per_delivered < 100 && (doc.order_type !='Sales')) {
					this.frm.add_custom_button("Make Maintenance Visit",
					 	function() { me.make_maintenance_visit(this);});
					
					this.frm.add_custom_button("Make Maintenance Schedule",
					 	function() { me.make_maintenance_schedule(this);});
				}

				// purchase request
				if (doc.order_type == 'Sales')
					this.frm.add_custom_button('Make ' + get_doctype_label('Purchase Request'),
					 	function() { me.make_purchae_request(this);});
			
				// sales invoice
				if (doc.per_billed < 100)
					this.frm.add_custom_button('Make Invoice', 
						function() { me.make_sales_invoice(this);});
						
				// stop sales order
				this.frm.add_custom_button("Stop Sales Order",
					function() { me.stop_transaction(this); }, "icon-ban-circle");
			}
			// to-do - sms
			this.frm.add_custom_button("Send SMS", this.send_sms);
		}
	},
	
	pull_quotation_items: function(doc, cdt, cdn) {
		var me = this;
		wn.call({
			doc: me.frm.doc,
			method: "pull_quotation_items",
			callback: function(r, rt) {
				unhide_field("quotation_date");
				me.refresh();
			}
		});
	},
	
	make_delivery_note: function() {
		wn.model.map_doclist([["Sales Order", "Delivery Note"], 
			["Sales Order Item", "Delivery Note Item"],
		 	["Sales Taxes and Charges", "Sales Taxes and Charges"], 
			["Sales Team", "Sales Team"]], this.frm.doc.name);
	},
	
	make_sales_invoice: function() {
		wn.model.map_doclist([["Sales Order", "Sales Invoice"], 
			["Sales Order Item", "Sales Invoice Item"],
		 	["Sales Taxes and Charges", "Sales Taxes and Charges"], 
			["Sales Team", "Sales Team"]], this.frm.doc.name);
	},
	
	make_purchae_request: function() {
		wn.model.map_doclist([["Sales Order", "Purchase Request"],
			["Sales Order Item", "Purchase Request Item"]], this.frm.doc.name);
	},

	make_maintenance_schedule: function() {
		var me = this;
		wn.call({
			doc: me.frm.doc,
			method: "check_maintenance_schedule",
			callback: function(r, rt) {
				if (r.message) {
					msgprint("You have already created Maintenance Schedule \
							against this Sales Order");
				} else {
					wn.model.map_doclist([["Sales Order", "Maintenance Schedule"],
						["Sales Order Item", "Maintenance Schedule Item"]], this.frm.doc.name);
				}
			}
		});
	},
	
	make_maintenance_visit: function() {
		var me = this;
		wn.call({
			doc: me.frm.doc,
			method: "check_maintenance_visit",
			callback: function(r, rt) {
				if (r.message) {
					msgprint("You have already created Maintenance Visit \
						against this Sales Order");
				} else {
					wn.model.map_doclist([["Sales Order", "Maintenance Schedule"],
						["Sales Order Item", "Maintenance Schedule Item"]], this.frm.doc.name);
				}
			}
		});
	},
	
	setup_get_query: function() {
		this._super();
		var me = this;
		
		// quotation
		this.frm.fields_dict['quotation'].get_query = function() {
			var condition = '';
			if (this.frm.doc.order_type) 
				condition = ' and ifnull(order_type, "") = "' + this.frm.doc.order_type + '"';
			if(this.frm.doc.customer) 
				condition += ' and  ifnull(customer, "") = "' + this.frm.doc.customer + '"';

			return repl('SELECT DISTINCT name, customer, posting_date \
				FROM `tabQuotation` WHERE company = "' + this.frm.doc.company + 
				'" and docstatus = 1 and status != "Order Lost" \
				and %(key)s LIKE \"%s\" %(cond)s ORDER BY name DESC LIMIT 50'
				, { condition: condition});
		}
	},
})


cur_frm.cscript = new erpnext.selling.SalesOrder({
	frm: cur_frm, item_table_field: "sales_order_items"});