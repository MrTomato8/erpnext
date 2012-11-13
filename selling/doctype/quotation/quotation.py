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
from webnotes.utils import cstr
from webnotes.model.doc import Document, addchild, make_autoname
from webnotes.model.utils import getlist
from webnotes.model.controller import get_obj
from webnotes import msgprint

from controllers.selling_controller import SellingController

class DocType(SellingController):
	def setup(self):
		self.item_table_field = "quotation_items"

	def validate(self):
		super(DocType, self).validate()
		self.set_last_contact_date()
		self.validate_order_type()
		self.set_next_contact_date()

	def on_submit(self):
		# to-do
		# get_obj('Authorization Control').validate_approving_authority(self.doc.doctype,
		# 		 	self.doc.company, self.doc.grand_total, self)
		self.update_opportunity_status("Quotation Sent")
		
	def on_cancel(self):
		self.update_opportunity_status("Open")

	def set_last_contact_date(self):
		if self.doc.contact_date_ref and self.doc.contact_date_ref != self.doc.contact_date:
			if getdate(self.doc.contact_date_ref) < getdate(self.doc.contact_date):
				self.doc.last_contact_date = self.doc.contact_date_ref
			else:
				msgprint("Contact Date Cannot be before Last Contact Date", raise_exception=1)

	def pull_opportunity_items(self):
		self.doclist = self.doc.clear_table(self.doclist, self.item_table_field)
		if self.doc.opportunity:
			mapper = webnotes.get_controller("DocType Mapper", "Opportunity-Quotation")

		import json
		from_to_list = [["Opportunity", "Quotation"], ["Opportunity Item", "Quotation Item"]]
		
		mapper.dt_map("Opportunity", "Quotation", self.doc.opportunity,
			self.doc, self.doclist, json.dumps(from_to_list))

	def declare_order_lost(self, reason):
		so = webnotes.conn.sql("""select parent from `tabSales Order Item` 
			where docstatus=1 and quotation = %s 
			and ifnull(parent, '') != '' and parent not like '%%old%%'""", self.doc.name)
		if so:
			msgprint("""Submitted sales order: %s exists against this quotation. 
				So you can not set theis order as lost""" % so[0][0], raise_exception=1)
		else:
			webnotes.conn.set(self.doc, 'order_lost_reason', reason)
			self.update_enquiry('Opportunity Lost')
			return True

	def update_opportunity_status(self, status):
		opportunity = ""
		for d in self.doclist.get({"parentfield": self.item_table_field}):
			if d.opportunity:
				opportunity = d.opportunity
				break
		
		if opportunity:
			webnotes.conn.set_value("Opportunity", opportunity, "status", status)
		
	def set_next_contact_date(self):
		if self.doc.contact_date and self.doc.contact_date_ref != self.doc.contact_date:
			if self.doc.contact_by:
				self.add_calendar_event()
			webnotes.conn.set(self.doc, 'contact_date_ref',self.doc.contact_date)

	def add_calendar_event(self):
		event_description = "To be contacted %s by %s" % ((self.doc.contact_person 
			or self.doc.customer or self.doc.lead_name or self.doc.lead), self.doc.contact_by)		
		if self.doc.to_discuss:
			event_description += "to discuss " + self.doc.to_discuss
		
		def _create_event():
			event = Document('Event')
			event.description = event_description
			event.event_date = self.doc.contact_date
			event.event_hour = '10:00'
			event.event_type = 'Private'
			event.ref_type = 'Opportunity'
			event.ref_name = self.doc.name
			event.save(1)
			return event
			
		def _add_participants(event):
			participants = [self.doc.owner]
			contact_by_email = webnotes.conn.get_value("Sales Person", 
				self.doc.contact_by, "email_id")
			if webnotes.conn.exists("Profile", contact_by_email):
				participants.append(contact_by_email)
			
			for p in participants:
				child = addchild(event, 'event_individuals', 'Event User', 0)
				child.person = p
				child.save(1)
				
		event = _create_event()
		_add_participants(event)

	def get_lead_details(self):
		lead = webnotes.conn.get_value("Lead", self.doc.lead, 
			["lead_name", "company_name", "territory"])
		ret = {
			"lead_name": lead["lead_name"] or "",
			"organization": lead["company_name"] or "",
			"territory": lead["territory"] or ""
		}
		return ret