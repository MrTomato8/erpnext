# ERPNext - web based ERP (http://erpnext.com)
# Copyright (C) 2012 Web Notes Technologies Pvt Ltd
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

from __future__ import unicode_literals
import webnotes
import webnotes.model
from webnotes import _, msgprint, DictObj
from webnotes.utils import add_days, getdate, flt, cint
from webnotes.model.code import get_obj

import stock.utils
from controllers.accounts_controller import AccountsController

class SellingController(AccountsController):
	def autoname(self):
		self.doc.name = make_autoname(self.doc.naming_series+'.#####')
	
	def validate(self):
		super(SellingController, self).validate()
		self.validate_max_discount()
		self.validate_exchange_rate()
		self.validate_project()
		self.get_sales_team_contribution()
				
	def validate_order_type(self):
		if self.doc.order_type in ["Maintenance", "Service"]:
			item_type = "service item"
			item_type_field = "is_service_item"
		elif sself.doc.order_type == "Sales":
			item_type = "sales item"
			item_table_field = "is_sales_item"
			
		for item in self.doclist.get({"parentfield": self.item_table_field}):
			if webnotes.conn.get_value("Item", item.item_code, item_type_field) == "No":
				msgprint("You can not select non-%s: %s, if order type is %s" 
					% (item_type, item.item_code, self.doc.order_type), raise_exception=1)
				
	def validate_max_discount(self):
		for item in self.doclist.get({'parentfield': self.item_table_field}):
			max_discount = webnotes.conn.get_value('Item', item.item_code, 'max_discount')
			if max_discount and flt(item.discount) > flt(max_discount):
				msgprint(_("""Discount on row no: %s is greater than 
					max discount (%s) allowed for Item: %s""") 
					% (item.idx, max_discount, item.item_code), raise_exception=1)
	
	def validate_exchange_rate(self):
		def_currency = webnotes.conn.get_value("Company", self.doc.company, "default_currency")
		if not def_currency:
			msgprint(_("Default currency not mentioned in Company Master"),
				raise_exception=1)

		def _check(currency, conv_rate, currency_type):
			if not conv_rate or (currency == def_currency and flt(conv_rate) != 1.00) or \
					(currency != def_currency and flt(conv_rate) == 1.00):
				msgprint(_("""Please enter appropriate Exchange Rate for %s 
					currency (%s) to base currency (%s)""") 
					% (currency_type, self.doc.currency, def_currency), raise_exception=1)
					
		_check(self.doc.currency, self.doc.exchange_rate, 'Customer')
		_check(self.doc.price_list_currency, self.doc.plc_exchange_rate, 'Price List')
		
	def validate_project(self):
		if self.doc.get('project_name') and self.doc.customer != webnotes.conn.get_value(
				'Project', self.doc.project_name, 'customer'):
			msgprint("Project: %s does not associate with customer: %s" 
				% (self.doc.project_name, self.doc.customer), raise_exception=1)
	
	def get_sales_team_contribution(self):
		total_contribution = sum([d.allocated_percentage for d in 
			self.doclist.get({'parentfield': 'sales_team'})])
		for d in self.doclist.get({"parentfield": 'sales_team'}):
			d.allocated_percentage = d.allocated_percentage*100/total_contribution
	
	def append_default_taxes(self):
		"""called in on_map to add rows in tax table when they are missing"""
		if not (self.doc.customer or 
				len(self.doclist.get({"parentfield": "taxes_and_charges"}))):
			self.doc.taxes_and_charges_master = webnotes.conn.get_value(
				"Sales Taxes and Charges Master", {"is_default[0]": 1}, "name")
			
			if not self.doc.taxes_and_charges_master: return
			self.append_taxes()
	
	def get_customer_details(self):
		# set primary address
		self.set_address(args)
		
		# set shipping address
		args.update({"is_shipping_address": 1})
		self.set_address(args)
		
		# set contact
		self.set_contact(args)
	
		res = webnotes.conn.sql("""select customer_name, default_currency
			from `tabCustomer` where name=%s and docstatus < 2""", (args.get("customer"),))
	
		if res:
			self.doc.customer_name = res[0][0]
			self.doc.currency = res[0][1]
			
	
	def pull_project_customer(self):
		if webnotes.conn.get_value("Project", self.doc.project_name, "customer"):
			mapper = webnotes.get_controller("DocType Mapper", "Project-%s" % self.doc.doctype)

			import json
			mapper.dt_map("Project", self.doc.doctype, self.doc.project_name,
				self.doc, self.doclist, json.dumps([["Project", self.doc.doctype]]))
		
	def get_item_details(self, args, item=None):
		args, item = self.process_args(args, item)
		
		ret = super(SellingController, self).get_item_details(args, item)
		
		# set default income account and cost center
		ret.income_account = item.doc.default_income_account or args.income_account,
		ret.cost_center = item.doc.default_sales_cost_center or args.cost_center,
		
		# rate as per selected price list
		if self.doc.price_list_name and self.doc.price_list_currency:
			exchange_rate = flt(self.doc.exchange_rate, self.precision.main.exchange_rate)
			ref_rate = self.get_ref_rate(args['item_code'])
			ret.print_ref_rate = ref_rate / exchange_rate
			ret.print_rate = ref_rate / exchange_rate
			ret.ref_rate = ref_rate
			ret.rate = ref_rate
			
		# get actual qty
		if ret.warehouse:
			ret.available_qty = stock.utils.get_actual_qty({
				'item_code': args.item_code, 'warehouse': ret.warehouse, 
				"posting_date": self.doc.posting_date, "posting_time": self.doc.posting_time or ""
			})
			
		# get customer code from Item Customer Detail
		customer_item_code = webnotes.conn.get_value("Item Customer Detail", 
			{"parent": args.item_code, "customer_name": self.doc.customer}, "ref_code")
		if customer_item_code:
			ret.customer_item_code = customer_item_code
		
		return ret
		
	
	def get_price_list_rate(self):
		for item in self.doclist.get({"parentfield": self.doc.item_table_field}):
			ref_rate = self.get_ref_rate(item.item_code)
			exchange_rate = flt(self.doc.exchange_rate, self.precision.main.exchange_rate)
			item.print_ref_rate = ref_rate / exchange_rate
			item.print_rate = ref_rate / exchange_rate
			item.print_amount = flt(item.qty, self.precision.item.qty) * ref_rate / exchange_rate
			item.discount = 0
			item.ref_rate = ref_rate
			item.rate = ref_rate			
			item.amount = flt(item.qty, self.precision.item.qty) * ref_rate
			
	def get_ref_rate(self, item_code):
		ref_rate_price_list_currency = webnotes.conn.get_value("Item Price", {"parent": item_code, 
			"price_list_name": self.doc.price_list_name, 
			"ref_currency": self.doc.price_list_currency}, "ref_rate")
			
		# ref rate @ base currency
		ref_rate = flt(ref_rate_price_list_currency, self.precision.item.ref_rate) * \
			flt(self.doc.plc_exchange_rate, self.precision.main.plc_exchange_rate)
		return ref_rate
		
	def get_commission(self):
		commission_rate = flt(webnotes.conn.get_value("Sales Partner", 
			self.doc.sales_partner, "commission_rate"), self.precision.main.commission_rate)
		return {
			'commission_rate':	commission_rate,
			'total_commission': (commission_rate * 
				flt(self.doc.net_total, self.precision.main.net_total)) / 100.0
		}
	def get_price_list_currency(self, args):
		""" Get all currencies in which price list is maintained"""
		plc = webnotes.conn.sql("""select distinct ref_currency from `tabItem Price` 
			where price_list_name = %s""", args.get("price_list_name"))
		plc = [d[0] for d in plc]
		import setup
		default_currency = setup.get_currency(args.get("company"))
		return plc, default_currency
