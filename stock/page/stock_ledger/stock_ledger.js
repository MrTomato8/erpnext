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

wn.pages['stock-ledger'].onload = function(wrapper) { 
	wn.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Ledger',
		single_column: true
	});
	
	new erpnext.StockLedger(wrapper);
	
	wrapper.appframe.add_home_breadcrumb()
	wrapper.appframe.add_module_breadcrumb("Stock")
	wrapper.appframe.add_breadcrumb("icon-bar-chart")
}

wn.require("app/js/stock_grid_report.js");

erpnext.StockLedger = erpnext.StockGridReport.extend({
	init: function(wrapper) {
		this._super({
			title: "Stock Ledger",
			page: wrapper,
			parent: $(wrapper).find('.layout-main'),
			appframe: wrapper.appframe,
			doctypes: ["Item", "Item Group", "Warehouse", "Stock Ledger Entry"]			
		})
	},

	setup_columns: function() {
		this.hide_balance = (this.is_default("item_code") || this.voucher_no) ? true : false;
		this.columns = [
			{id: "posting_datetime", name: "Posting Date", field: "posting_datetime", width: 120,
				formatter: this.date_formatter},
			{id: "item_code", name: "Item Code", field: "item_code", width: 160, 	
				link_formatter: {
					filter_input: "item_code",
					open_btn: true,
					doctype: '"Item"',
				}},
			{id: "warehouse", name: "Warehouse", field: "warehouse", width: 100,
				link_formatter: {filter_input: "warehouse"}},
			{id: "qty", name: "Qty", field: "qty", width: 100,
				formatter: this.currency_formatter},
			{id: "balance", name: "Balance Qty", field: "balance", width: 100,
				formatter: this.currency_formatter,
				hidden: this.hide_balance},
			{id: "balance_value", name: "Balance Value", field: "balance_value", width: 100,
				formatter: this.currency_formatter, hidden: this.hide_balance},
			{id: "voucher_type", name: "Voucher Type", field: "voucher_type", width: 120},
			{id: "voucher_no", name: "Voucher No", field: "voucher_no", width: 160,
				link_formatter: {
					filter_input: "voucher_no",
					open_btn: true,
					doctype: "dataContext.voucher_type"
				}},
			{id: "description", name: "Description", field: "description", width: 200,
				formatter: this.text_formatter},
		];
		
	},
	filters: [
		{fieldtype:"Select", label: "Warehouse", link:"Warehouse", default_value: "Select Warehouse...",
			filter: function(val, item, opts) {
				return item.warehouse == val || val == opts.default_value;
			}},
		{fieldtype:"Select", label: "Item Code", link:"Item", default_value: "Select Item...",
			filter: function(val, item, opts) {
				return item.item_code == val || val == opts.default_value;
			}},
		{fieldtype:"Data", label: "Voucher No",
			filter: function(val, item, opts) {
				if(!val) return true;
				return (item.voucher_no && item.voucher_no.indexOf(val)!=-1);
			}},
		{fieldtype:"Date", label: "From Date", filter: function(val, item) {
			return dateutil.str_to_obj(val) <= dateutil.str_to_obj(item.posting_date);
		}},
		{fieldtype:"Label", label: "To"},
		{fieldtype:"Date", label: "To Date", filter: function(val, item) {
			return dateutil.str_to_obj(val) >= dateutil.str_to_obj(item.posting_date);
		}},
		{fieldtype:"Button", label: "Refresh", icon:"icon-refresh icon-white", cssClass:"btn-info"},
		{fieldtype:"Button", label: "Reset Filters"}
	],
	init_filter_values: function() {
		this._super();
		this.filter_inputs.warehouse.get(0).selectedIndex = 0;
	},
	prepare_data: function() {
		var me = this;
		if(!this.item_by_name)
			this.item_by_name = this.make_name_map(wn.report_dump.data["Item"]);
		var data = wn.report_dump.data["Stock Ledger Entry"];
		var out = [];

		var opening = {
			item_code: "On " + dateutil.str_to_user(this.from_date), qty: 0.0, balance: 0.0,
				id:"_opening", _show: true, _style: "font-weight: bold", balance_value: 0.0
		}
		var total_in = {
			item_code: "Total In", qty: 0.0, balance: 0.0, balance_value: 0.0,
				id:"_total_in", _show: true, _style: "font-weight: bold"
		}
		var total_out = {
			item_code: "Total Out", qty: 0.0, balance: 0.0, balance_value: 0.0,
				id:"_total_out", _show: true, _style: "font-weight: bold"
		}
		
		// clear balance
		$.each(wn.report_dump.data["Item"], function(i, item) {
			item.balance = item.balance_value = 0.0; 
		});
		
		// initialize warehouse-item map
		this.item_warehouse = {};
		
		// 
		for(var i=0, j=data.length; i<j; i++) {
			var sl = data[i];
			var item = me.item_by_name[sl.item_code]
			var wh = me.get_item_warehouse(sl.warehouse, sl.item_code);
			sl.description = item.description;
			sl.posting_datetime = sl.posting_date + " " + sl.posting_time;
			var posting_datetime = dateutil.str_to_obj(sl.posting_datetime);
			
			var is_fifo = item.valuation_method ? item.valuation_method=="FIFO" 
				: sys_defaults.valuation_method=="FIFO";
			var value_diff = me.get_value_diff(wh, sl, is_fifo);

			// opening, transactions, closing, total in, total out
			var before_end = posting_datetime <= dateutil.str_to_obj(me.to_date + " 23:59:59");
			if((!me.is_default("item_code") ? me.apply_filter(sl, "item_code") : true)
				&& me.apply_filter(sl, "warehouse") && me.apply_filter(sl, "voucher_no")) {
				if(posting_datetime < dateutil.str_to_obj(me.from_date)) {
					opening.balance += sl.qty;
					opening.balance_value += value_diff;
				} else if(before_end) {
					if(sl.qty > 0) {
						total_in.qty += sl.qty;
						total_in.balance_value += value_diff;
					} else {
						total_out.qty += (-1 * sl.qty);
						total_out.balance_value += value_diff;
					}
				}
			}
			
			if(!before_end) break;
			
			// apply filters
			if(me.apply_filters(sl)) {
				out.push(sl);
			}
			
			// update balance
			if((!me.is_default("warehouse") ? me.apply_filter(sl, "warehouse") : true)) {
				sl.balance = me.item_by_name[sl.item_code].balance + sl.qty;
				me.item_by_name[sl.item_code].balance = sl.balance;
				
				sl.balance_value = me.item_by_name[sl.item_code].balance_value + value_diff;
				me.item_by_name[sl.item_code].balance_value = sl.balance_value;		
			}
		}
					
		if(me.item_code != me.item_code_default && !me.voucher_no) {
			var closing = {
				item_code: "On " + dateutil.str_to_user(this.to_date), 
				balance: (out.length ? out[out.length-1].balance : 0), qty: 0,
				balance_value: (out.length ? out[out.length-1].balance_value : 0),
				id:"_closing", _show: true, _style: "font-weight: bold"
			};
			total_out.balance_value = -total_out.balance_value;
			var out = [opening].concat(out).concat([total_in, total_out, closing]);
		}
		
		this.data = out;
	},
	get_plot_data: function() {
		var data = [];
		var me = this;
		if(me.hide_balance) return false;
		data.push({
			label: me.item_code,
			data: [[dateutil.str_to_obj(me.from_date).getTime(), me.data[0].balance]]
				.concat($.map(me.data, function(col, idx) {
					if (col.posting_datetime) {
						return [[dateutil.str_to_obj(col.posting_datetime).getTime(), col.balance - col.qty],
								[dateutil.str_to_obj(col.posting_datetime).getTime(), col.balance]]
					}
					return null;
				})).concat([
					// closing
					[dateutil.str_to_obj(me.to_date).getTime(), me.data[me.data.length - 1].balance]
				]),
			points: {show: true},
			lines: {show: true, fill: true},
		});
		return data;
	},
	get_plot_options: function() {
		return {
			grid: { hoverable: true, clickable: true },
			xaxis: { mode: "time", 
				min: dateutil.str_to_obj(this.from_date).getTime(),
				max: dateutil.str_to_obj(this.to_date).getTime(),
			},
		}
	},
	get_tooltip_text: function(label, x, y) {
		var d = new Date(x);
		var date = dateutil.obj_to_user(d) + " " + d.getHours() + ":" + d.getMinutes();
	 	var value = fmt_money(y);
		return value.bold() + " on " + date;
	}
});